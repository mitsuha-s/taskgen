package extraction

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"teacher-assistant/backend/internal/db"
	"teacher-assistant/backend/internal/files"
	"teacher-assistant/backend/internal/llm"
)

const totalPipelineSteps = 4

var ErrPipelineNotReady = errors.New("pipeline is not waiting for confirmation")
var ErrInvalidPipelineStep = errors.New("invalid pipeline step")
var ErrInvalidFinalModel = errors.New("invalid final model")
var ErrInvalidVariantCount = errors.New("invalid variant count")

type Service struct {
	store    *db.Store
	storage  *files.LocalStorage
	provider llm.VisionProvider
	logger   *slog.Logger
}

type ContinueOptions struct {
	FinalModel   string
	VariantCount int
	StepModel    string
}

type StartOptions struct {
	UseDefaultSource bool
	StepModel        string
}

type pipelineStepResult struct {
	Step      int    `json:"step"`
	Key       string `json:"key"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

type pipelineContent struct {
	SourceHTML      string               `json:"source_html,omitempty"`
	Parameters      string               `json:"parameters,omitempty"`
	VariationRules  string               `json:"variation_rules,omitempty"`
	VariantHTML     string               `json:"variant_html,omitempty"`
	VariantsHTML    []string             `json:"variants_html,omitempty"`
	SelectedVariant int                  `json:"selected_variant,omitempty"`
	UsedDefaultHTML bool                 `json:"used_default_html,omitempty"`
	Steps           []pipelineStepResult `json:"steps"`
}

func NewService(store *db.Store, storage *files.LocalStorage, provider llm.VisionProvider, logger *slog.Logger) *Service {
	return &Service{store: store, storage: storage, provider: provider, logger: logger}
}

func (s *Service) Start(ctx context.Context, assignmentID string, options StartOptions) (db.ExtractionRun, error) {
	if !options.UseDefaultSource {
		if _, err := s.store.GetImageByAssignmentID(ctx, assignmentID); err != nil {
			return db.ExtractionRun{}, err
		}
	}

	run, err := s.store.CreateExtractionRun(ctx, assignmentID, PromptVersion)
	if err != nil {
		return db.ExtractionRun{}, err
	}

	stepModel, err := resolveFinalModel(options.StepModel)
	if err != nil {
		return db.ExtractionRun{}, err
	}
	go s.executeStep(run.ID, 1, "", 1, options.UseDefaultSource, stepModel)
	return run, nil
}

func (s *Service) Continue(ctx context.Context, runID string, options ContinueOptions) (db.ExtractionRun, error) {
	run, err := s.store.GetExtractionRun(ctx, runID)
	if err != nil {
		return db.ExtractionRun{}, err
	}
	if run.Status != "awaiting_confirmation" || run.CurrentStep >= totalPipelineSteps {
		return db.ExtractionRun{}, ErrPipelineNotReady
	}

	nextStep := run.CurrentStep + 1
	if err := s.store.MarkExtractionStepRunning(ctx, run.ID, nextStep); err != nil {
		return db.ExtractionRun{}, err
	}

	finalModel, err := resolveFinalModel(options.FinalModel)
	if err != nil {
		return db.ExtractionRun{}, err
	}
	variantCount, err := resolveVariantCount(options.VariantCount)
	if err != nil {
		return db.ExtractionRun{}, err
	}
	stepModel, err := resolveFinalModel(options.StepModel)
	if err != nil {
		return db.ExtractionRun{}, err
	}
	go s.executeStep(run.ID, nextStep, finalModel, variantCount, false, stepModel)
	return run, nil
}

func (s *Service) Regenerate(ctx context.Context, runID string, step int) (db.ExtractionRun, error) {
	if step < 1 || step > totalPipelineSteps {
		return db.ExtractionRun{}, ErrInvalidPipelineStep
	}
	run, err := s.store.GetExtractionRun(ctx, runID)
	if err != nil {
		return db.ExtractionRun{}, err
	}
	if run.Status == "pending" || run.Status == "running" {
		return db.ExtractionRun{}, ErrPipelineNotReady
	}
	results := keepPipelineResultsBefore(parsePipelineResults(run.StepResults), step)
	content := buildPipelineContent(results)
	parsedContent, err := json.Marshal(content)
	if err != nil {
		return db.ExtractionRun{}, err
	}
	stepResults, err := json.Marshal(results)
	if err != nil {
		return db.ExtractionRun{}, err
	}
	if err := s.store.UpdateExtractionStepResults(ctx, runID, "running", "extracting", step, stepResults, parsedContent); err != nil {
		return db.ExtractionRun{}, err
	}
	go s.executeStep(run.ID, step, "", 1, false, "")
	return run, nil
}

func (s *Service) UpdateStep(ctx context.Context, runID string, step int, content string) (db.ExtractionRun, error) {
	if step < 1 || step > totalPipelineSteps {
		return db.ExtractionRun{}, ErrInvalidPipelineStep
	}
	content = strings.TrimSpace(content)
	if content == "" {
		return db.ExtractionRun{}, ErrInvalidPipelineStep
	}
	run, err := s.store.GetExtractionRun(ctx, runID)
	if err != nil {
		return db.ExtractionRun{}, err
	}
	if run.Status == "pending" || run.Status == "running" {
		return db.ExtractionRun{}, ErrPipelineNotReady
	}

	results := keepPipelineResultsBefore(parsePipelineResults(run.StepResults), step)
	results = append(results, pipelineStepResult{
		Step:      step,
		Key:       pipelineStepKey(step),
		Title:     pipelineStepTitle(step),
		Content:   content,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	})
	status := "awaiting_confirmation"
	assignmentStatus := "processing_waiting"
	if step == totalPipelineSteps {
		status = "succeeded"
		assignmentStatus = "processed"
	}
	parsedContent, err := json.Marshal(buildPipelineContent(results))
	if err != nil {
		return db.ExtractionRun{}, err
	}
	stepResults, err := json.Marshal(results)
	if err != nil {
		return db.ExtractionRun{}, err
	}
	if err := s.store.UpdateExtractionStepResults(ctx, runID, status, assignmentStatus, step, stepResults, parsedContent); err != nil {
		return db.ExtractionRun{}, err
	}
	if step == 4 {
		updatedRun, err := s.store.GetExtractionRun(ctx, runID)
		if err == nil {
			var parsed pipelineContent
			if json.Unmarshal(updatedRun.ParsedContent, &parsed) == nil && len(parsed.VariantsHTML) > 0 {
				parsed.VariantHTML = content
				parsed.SelectedVariant = 1
				for index, variant := range parsed.VariantsHTML {
					if strings.TrimSpace(variant) == strings.TrimSpace(content) {
						parsed.SelectedVariant = index + 1
						break
					}
				}
				if patched, marshalErr := json.Marshal(parsed); marshalErr == nil {
					_ = s.store.UpdateExtractionStepResults(ctx, runID, status, assignmentStatus, step, stepResults, patched)
				}
			}
		}
	}
	return s.store.GetExtractionRun(ctx, runID)
}

func (s *Service) executeStep(runID string, step int, finalModel string, variantCount int, useDefaultSource bool, stepModel string) {
	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Minute)
	defer cancel()

	run, err := s.store.GetExtractionRun(ctx, runID)
	if err != nil {
		s.logger.Error("failed to load extraction run", "run_id", runID, "error", err)
		return
	}

	if err := s.store.MarkExtractionStepRunning(ctx, runID, step); err != nil {
		s.logger.Error("failed to mark extraction step running", "run_id", runID, "step", step, "error", err)
		return
	}

	results := parsePipelineResults(run.StepResults)
	resp, result, variants, input, err := s.runStep(ctx, run, step, results, finalModel, variantCount, useDefaultSource, stepModel)
	if err != nil {
		provider, model := providerMeta(resp)
		rawResponse := ""
		if resp != nil {
			rawResponse = resp.RawResponse
		}
		_ = s.store.InsertLLMRun(ctx, db.LLMRunInput{
			TaskType:      pipelineTaskType(step),
			Provider:      provider,
			Model:         model,
			PromptVersion: PromptVersion,
			Input:         input,
			RawOutput:     rawResponse,
			Status:        "failed",
			ErrorMessage:  err.Error(),
		})
		s.fail(ctx, runID, provider, model, rawResponse, err.Error())
		return
	}

	results = append(results, result)
	content := buildPipelineContent(results)
	if useDefaultSource && step == 1 {
		content.UsedDefaultHTML = true
	}
	if parsedExisting := parsePipelineContent(run.ParsedContent); parsedExisting.UsedDefaultHTML {
		content.UsedDefaultHTML = true
	}
	if step == 4 && len(variants) > 0 {
		content.VariantsHTML = variants
		content.SelectedVariant = 1
		content.VariantHTML = variants[0]
	}
	parsedContent, err := json.Marshal(content)
	if err != nil {
		s.fail(ctx, runID, resp.Provider, resp.Model, resp.RawResponse, err.Error())
		return
	}
	stepResults, err := json.Marshal(results)
	if err != nil {
		s.fail(ctx, runID, resp.Provider, resp.Model, resp.RawResponse, err.Error())
		return
	}
	resultJSON, _ := json.Marshal(result)

	if err := s.store.InsertLLMRun(ctx, db.LLMRunInput{
		TaskType:      pipelineTaskType(step),
		Provider:      resp.Provider,
		Model:         resp.Model,
		PromptVersion: PromptVersion,
		Input:         input,
		RawOutput:     resp.RawResponse,
		ParsedOutput:  resultJSON,
		Status:        "succeeded",
	}); err != nil {
		s.logger.Error("failed to insert llm run", "run_id", runID, "step", step, "error", err)
	}

	status := "awaiting_confirmation"
	assignmentStatus := "processing_waiting"
	if step == totalPipelineSteps {
		status = "succeeded"
		assignmentStatus = "processed"
	}

	if err := s.store.FinishExtractionStep(ctx, runID, db.ExtractionStepFinishInput{
		Status:           status,
		AssignmentStatus: assignmentStatus,
		Provider:         resp.Provider,
		Model:            resp.Model,
		PromptVersion:    PromptVersion,
		RawResponse:      resp.RawResponse,
		CurrentStep:      step,
		StepResults:      stepResults,
		ParsedContent:    parsedContent,
		Warnings:         json.RawMessage("[]"),
	}); err != nil {
		s.logger.Error("failed to finish extraction step", "run_id", runID, "step", step, "error", err)
	}
}

func (s *Service) runStep(ctx context.Context, run db.ExtractionRun, step int, results []pipelineStepResult, finalModel string, variantCount int, useDefaultSource bool, stepModel string) (*llm.TextGenerationResponse, pipelineStepResult, []string, json.RawMessage, error) {
	var (
		resp *llm.TextGenerationResponse
		err  error
	)

	input := map[string]any{
		"assignment_id":  run.AssignmentID,
		"run_id":         run.ID,
		"step":           step,
		"prompt_version": PromptVersion,
	}

	switch step {
	case 1:
		if useDefaultSource {
			result := pipelineStepResult{
				Step:      step,
				Key:       pipelineStepKey(step),
				Title:     pipelineStepTitle(step),
				Content:   defaultSourceHTML(),
				CreatedAt: time.Now().UTC().Format(time.RFC3339),
			}
			input["use_default_source"] = true
			return &llm.TextGenerationResponse{
				RawResponse: defaultSourceHTML(),
				Content:     defaultSourceHTML(),
				Provider:    "local",
				Model:       "default-html",
			}, result, nil, mustJSON(input), nil
		}
		image, err := s.store.GetImageByAssignmentID(ctx, run.AssignmentID)
		if err != nil {
			return nil, pipelineStepResult{}, nil, mustJSON(input), err
		}
		prompt := htmlFromImagePrompt()
		input["image_path"] = image.StoredPath
		input["mime_type"] = image.MimeType
		input["prompt"] = prompt
		resp, err = s.provider.ConvertAssignmentImageToMarkdown(ctx, llm.ConvertAssignmentImageToMarkdownRequest{
			ImagePath:     s.storage.FullPath(image.StoredPath),
			MimeType:      image.MimeType,
			Prompt:        prompt,
			PromptVersion: PromptVersion,
			Model:         stepModel,
		})
	case 2:
		sourceHTML := resultContent(results, "source_html")
		if sourceHTML == "" {
			return nil, pipelineStepResult{}, nil, mustJSON(input), errors.New("step 1 result is missing")
		}
		prompt := parametersPrompt(sourceHTML)
		input["prompt"] = prompt
		resp, err = s.provider.GenerateAssignmentText(ctx, llm.GenerateAssignmentTextRequest{
			Prompt:        prompt,
			PromptVersion: PromptVersion,
			Model:         stepModel,
		})
	case 3:
		sourceHTML := resultContent(results, "source_html")
		parameters := resultContent(results, "parameters")
		if sourceHTML == "" || parameters == "" {
			return nil, pipelineStepResult{}, nil, mustJSON(input), errors.New("previous pipeline results are missing")
		}
		prompt := variationRulesPrompt(sourceHTML, parameters)
		input["prompt"] = prompt
		resp, err = s.provider.GenerateAssignmentText(ctx, llm.GenerateAssignmentTextRequest{
			Prompt:        prompt,
			PromptVersion: PromptVersion,
			Model:         stepModel,
		})
	case 4:
		sourceHTML := resultContent(results, "source_html")
		parameters := resultContent(results, "parameters")
		variationRules := resultContent(results, "variation_rules")
		if sourceHTML == "" || parameters == "" || variationRules == "" {
			return nil, pipelineStepResult{}, nil, mustJSON(input), errors.New("previous pipeline results are missing")
		}
		prompt := variantsPrompt(sourceHTML, parameters, variationRules, variantCount)
		input["prompt"] = prompt
		input["variant_count"] = variantCount
		model := finalModel
		if model == "" {
			model = stepModel
		}
		resp, err = s.provider.GenerateAssignmentText(ctx, llm.GenerateAssignmentTextRequest{
			Prompt:        prompt,
			PromptVersion: PromptVersion,
			Model:         model,
		})
	default:
		return nil, pipelineStepResult{}, nil, mustJSON(input), fmt.Errorf("unsupported pipeline step %d", step)
	}
	if err != nil {
		return resp, pipelineStepResult{}, nil, mustJSON(input), err
	}

	content := normalizeLLMText(resp.Content)
	variants := []string(nil)
	if step == 4 {
		variants = parseHTMLVariants(content)
		if len(variants) == 0 {
			variants = []string{content}
		}
		content = variants[0]
	}
	result := pipelineStepResult{
		Step:      step,
		Key:       pipelineStepKey(step),
		Title:     pipelineStepTitle(step),
		Content:   content,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	return resp, result, variants, mustJSON(input), nil
}

func (s *Service) fail(ctx context.Context, runID, provider, model, rawResponse, message string) {
	if err := s.store.FinishExtractionFailed(ctx, runID, provider, model, PromptVersion, rawResponse, message); err != nil {
		s.logger.Error("failed to mark extraction failed", "run_id", runID, "error", err)
	}
}

func parsePipelineResults(raw json.RawMessage) []pipelineStepResult {
	if len(raw) == 0 || string(raw) == "null" {
		return []pipelineStepResult{}
	}
	var results []pipelineStepResult
	if err := json.Unmarshal(raw, &results); err != nil {
		return []pipelineStepResult{}
	}
	return results
}

func parsePipelineContent(raw json.RawMessage) pipelineContent {
	if len(raw) == 0 || string(raw) == "null" {
		return pipelineContent{}
	}
	var content pipelineContent
	if err := json.Unmarshal(raw, &content); err != nil {
		return pipelineContent{}
	}
	return content
}

func buildPipelineContent(results []pipelineStepResult) pipelineContent {
	return pipelineContent{
		SourceHTML:      resultContent(results, "source_html"),
		Parameters:      resultContent(results, "parameters"),
		VariationRules:  resultContent(results, "variation_rules"),
		VariantHTML:     resultContent(results, "variant_html"),
		Steps:           results,
	}
}

func resultContent(results []pipelineStepResult, key string) string {
	for _, result := range results {
		if result.Key == key {
			return result.Content
		}
	}
	return ""
}

func keepPipelineResultsBefore(results []pipelineStepResult, step int) []pipelineStepResult {
	kept := make([]pipelineStepResult, 0, len(results))
	for _, result := range results {
		if result.Step < step {
			kept = append(kept, result)
		}
	}
	return kept
}

func resolveFinalModel(option string) (string, error) {
	selected := strings.ToLower(strings.TrimSpace(option))
	switch selected {
	case "":
		return "", nil
	case "pro":
		return "GigaChat-Pro", nil
	case "lite":
		return "GigaChat-2", nil
	default:
		return "", ErrInvalidFinalModel
	}
}

func resolveVariantCount(count int) (int, error) {
	if count == 0 {
		return 1, nil
	}
	if count < 1 || count > 10 {
		return 0, ErrInvalidVariantCount
	}
	return count, nil
}

func parseHTMLVariants(content string) []string {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil
	}
	content = strings.TrimPrefix(content, "```json")
	content = strings.TrimPrefix(content, "```")
	content = strings.TrimSuffix(content, "```")
	content = strings.TrimSpace(content)

	var wrapper struct {
		Variants []string `json:"variants"`
	}
	if err := json.Unmarshal([]byte(content), &wrapper); err == nil && len(wrapper.Variants) > 0 {
		clean := make([]string, 0, len(wrapper.Variants))
		for _, variant := range wrapper.Variants {
			trimmed := strings.TrimSpace(variant)
			if trimmed != "" {
				clean = append(clean, trimmed)
			}
		}
		return clean
	}

	var direct []string
	if err := json.Unmarshal([]byte(content), &direct); err == nil && len(direct) > 0 {
		clean := make([]string, 0, len(direct))
		for _, variant := range direct {
			trimmed := strings.TrimSpace(variant)
			if trimmed != "" {
				clean = append(clean, trimmed)
			}
		}
		return clean
	}
	return nil
}

func pipelineStepKey(step int) string {
	switch step {
	case 1:
		return "source_html"
	case 2:
		return "parameters"
	case 3:
		return "variation_rules"
	case 4:
		return "variant_html"
	default:
		return "unknown"
	}
}

func pipelineStepTitle(step int) string {
	switch step {
	case 1:
		return "HTML исходного задания"
	case 2:
		return "Параметры задания"
	case 3:
		return "Допустимые изменения"
	case 4:
		return "Новый вариант задания (HTML)"
	default:
		return "Шаг пайплайна"
	}
}

func pipelineTaskType(step int) string {
	return fmt.Sprintf("assignment_pipeline_step_%d", step)
}

func mustJSON(value any) json.RawMessage {
	data, err := json.Marshal(value)
	if err != nil {
		return json.RawMessage("{}")
	}
	return data
}

func providerMeta(resp *llm.TextGenerationResponse) (string, string) {
	if resp == nil {
		return "unknown", ""
	}
	return resp.Provider, resp.Model
}

func normalizeLLMText(content string) string {
	content = strings.TrimSpace(content)
	if strings.HasPrefix(content, "```") {
		lines := strings.Split(content, "\n")
		if len(lines) >= 2 {
			lines = lines[1:]
			if strings.TrimSpace(lines[len(lines)-1]) == "```" {
				lines = lines[:len(lines)-1]
			}
			content = strings.TrimSpace(strings.Join(lines, "\n"))
		}
	}
	return content
}

func htmlFromImagePrompt() string {
	return `Я отправляю тебе школьное задание. Преобразуй его в валидный HTML для печати.

Требования:
- Верни только HTML без markdown и без пояснений.
- Используй семантическую разметку: h1-h3, p, ul/ol/li, table при необходимости.
- Не добавляй <html>, <head>, <body>, верни только содержимое документа.
- Сохрани структуру и формулировки задания, ничего не решай и не улучшай.`
}

func parametersPrompt(sourceHTML string) string {
	return `Я отправляю тебе задание в виде HTML файла. По данным из файла определи параметры, которые я опишу ниже. Выбери один вариант из списка возможных значений, если они указаны. Если значение параметра определить не удалось, используй "*".

Параметры
Предметная область: Русский язык | Математика | Обществознание | Информатика и ИКТ | География | Биология | Физика | Химия | История | Литература | Иностранные языки

Тип задания: Множественный выбор (Multiple choice) | Альтернативный выбор (True/False) | Перекрестный выбор (Matching) | Упорядочение (Rearrangement) | Заполнение пропусков (Completion) | Вставка слова в нужной форме / Трансформация (Transformation) | Ответ на вопрос (Answering questions) | Перевод (Translation) | Диалог / Интервью (Dialogue / Interview) | Обсуждение (Discussion) | Написание письма / эссе (Letter / Essay writing) | Имитация / Кроссворд / языковые игры (Crossword / Language games)

Предполагаемый класс: 1-11

Уровень сложности задания: 1-10

В ответе перечисли только эти параметры и их значения. Писать свои комментарии и дополнительный текст не нужно.

Пример вывода:
Предметная область: Иностранные языки
Тип задания: Перекрестный выбор (Matching)
Предполагаемый класс: 10
Уровень сложности задания: 7

<результат step1_html>
` + sourceHTML + `
</результат step1_html>`
}

func variationRulesPrompt(sourceHTML, parameters string) string {
	return `Я отправляю тебе задание в виде HTML файла. Необходимо на его основе создать ещё один новый вариант такого же задания за счет допустимых изменений. Было определено, что это задание имеет следующие параметры:

<результат step2>
` + parameters + `
</результат step2>

Допустимый характер вариации (можно выбрать несколько): замена числовых данных (диапазон, тип чисел — целые, десятичные, дроби), изменение порядка перечисления (список условий, объектов, действий), синонимическая замена неключевых формулировок, замена контекста (ситуации, примеры) при сохранении логики, изменение имён, названий, единиц измерения (без изменения сложности), перестановка шагов в многошаговой инструкции.

В качестве ответа пришли только список допустимых вариаций изменений этого задания без дополнительного текста и без твоих комментариев.

Пример ответа:
замена числовых данных (диапазон, тип чисел — целые, десятичные, дроби), перестановка шагов в многошаговой инструкции

<результат step1_html>
` + sourceHTML + `
</результат step1_html>`
}

func variantsPrompt(sourceHTML, parameters, variationRules string, variantCount int) string {
	return fmt.Sprintf(`Я отправляю тебе задание в виде HTML файла. Необходимо на его основе создать %d новых вариантов такого же задания. Было определено, что это задание имеет следующие параметры:

<результат step2>
` + parameters + `
</результат step2>

Определи части задания, которые можно изменять, а какие нельзя, например формулировка задания, нумерация, индексы букв и пр., чтобы избежать нарушения логики.

Также определено, что нельзя менять следующий текст (если тут стоит "-", то изменения допустимы на твое усмотрение):
-

Допустимые изменения в задании для создания новых вариантов:
` + variationRules + `

Верни JSON строго в одном из форматов:
1) {"variants": ["<section>...</section>", "..."]}
или
2) ["<section>...</section>", "..."]

Требования:
- Вариантов должно быть ровно %d.
- Каждый вариант должен быть валидным HTML-фрагментом (без html/head/body).
- Решать задания не нужно.
- Без дополнительного текста, только JSON.

<результат step1_html>
`+sourceHTML+`
</результат step1_html>`, variantCount, variantCount)
}

func defaultSourceHTML() string {
	return `<h1>Тема 10 № 39</h1>
<p>Установите соответствие между заголовками 1-8 и текстами A-G. Запишите свои ответы в таблицу. Используйте каждую цифру только один раз. В задании один лишний заголовок.</p>
<ol>
  <li>Places to stay in.</li>
  <li>Arts and culture.</li>
  <li>New country image.</li>
  <li>Going out.</li>
  <li>Different landscapes.</li>
  <li>Transport system.</li>
  <li>National languages.</li>
  <li>Eating out.</li>
</ol>
<p>A. Belgium has always had a lot more than the faceless administrative buildings that you can see in the outskirts of its capital, Brussels. A number of beautiful historic cities and Brussels itself offer impressive architecture, lively nightlife, first-rate restaurants and numerous other attractions for out visitors. Today, the old-fashioned idea of 'boring Belgium' has been well and truly forgotten, as more and more people discover its very individual charms for themselves.</p>
<p>B. Nature in Belgium is varied. The rivers and hills of the Ardennes in the southeast contrast sharply with the rolling plains which make up much of the northern and western countryside. The most notable features are the great forest near the frontier with Germany and Luxembourg and the wide, sandy beaches of the northern coast.</p>
<p>C. It is easy both to enter and to travel around pocket-sized Belgium which is divided into the Dutch-speaking north and the French-speaking south. Officially the Belgians speak French and German, Dutch is spoken slightly more widely than French, and German is spoken the least. The Belgians, living in the north, will often prefer to answer visitors in English rather than French, even if the visitor's French is good.</p>
<p>D. Belgium has a wide range of hotels from 5-star luxury to small family pensions and inns. In some regions of the country, farm holidays are available. There visitors can (for a small cost) participate in the daily work of the farm. There are plenty of opportunities to rent furnished villas, flats, rooms, or bungalows for a holiday period. These holiday houses and flats are comfortable and well-equipped.</p>
<p>E. The Belgian style of cooking is similar to French, based on meat and seafood. Each region in Belgium has its own special dish. Butter, cream, beer and wine are generally used in cooking. The Belgians are keen on their food, and the country is very well supplied with excellent restaurants to suit all budgets. The perfect evening out here involves a delicious meal, and the restaurants and cafes are busy at all times of the week.</p>
<p>F. As well as being one of the best cities in the world for eating out (both for its high quality and range), Brussels has a very active and varied nightlife. It has 10 theatres which produce plays in both Dutch and French. There are also dozens of cinemas, numerous discos and many other night-time cafes in Brussels. Elsewhere, the nightlife choices depend on the size of the town, but there is no shortage of fun to be had in any of the major cities.</p>
<p>G. There is a good system of underground trains, trams and buses in all the major towns and cities. In addition, Belgium's waterways offer a pleasant way to enjoy the country. Visitors can take a one-hour cruise around the canals of Bruges (sometimes described as the Venice of the North) or an extended cruise along the rivers and canals linking the major cities of Belgium and the Netherlands.</p>
<table>
  <tr>
    <th>Текст</th>
    <th>A</th>
    <th>B</th>
    <th>C</th>
    <th>D</th>
    <th>E</th>
    <th>F</th>
    <th>G</th>
  </tr>
  <tr>
    <td>Заголовок</td>
    <td></td>
    <td></td>
    <td></td>
    <td></td>
    <td></td>
    <td></td>
    <td></td>
  </tr>
</table>`
}
