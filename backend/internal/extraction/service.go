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

type Service struct {
	store    *db.Store
	storage  *files.LocalStorage
	provider llm.VisionProvider
	logger   *slog.Logger
}

type pipelineStepResult struct {
	Step      int    `json:"step"`
	Key       string `json:"key"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

type pipelineContent struct {
	Markdown        string               `json:"markdown,omitempty"`
	Parameters      string               `json:"parameters,omitempty"`
	VariationRules  string               `json:"variation_rules,omitempty"`
	VariantMarkdown string               `json:"variant_markdown,omitempty"`
	Steps           []pipelineStepResult `json:"steps"`
}

func NewService(store *db.Store, storage *files.LocalStorage, provider llm.VisionProvider, logger *slog.Logger) *Service {
	return &Service{store: store, storage: storage, provider: provider, logger: logger}
}

func (s *Service) Start(ctx context.Context, assignmentID string) (db.ExtractionRun, error) {
	if _, err := s.store.GetImageByAssignmentID(ctx, assignmentID); err != nil {
		return db.ExtractionRun{}, err
	}

	run, err := s.store.CreateExtractionRun(ctx, assignmentID, PromptVersion)
	if err != nil {
		return db.ExtractionRun{}, err
	}

	go s.executeStep(run.ID, 1)
	return run, nil
}

func (s *Service) Continue(ctx context.Context, runID string) (db.ExtractionRun, error) {
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

	go s.executeStep(run.ID, nextStep)
	return run, nil
}

func (s *Service) executeStep(runID string, step int) {
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
	resp, result, input, err := s.runStep(ctx, run, step, results)
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

func (s *Service) runStep(ctx context.Context, run db.ExtractionRun, step int, results []pipelineStepResult) (*llm.TextGenerationResponse, pipelineStepResult, json.RawMessage, error) {
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
		image, err := s.store.GetImageByAssignmentID(ctx, run.AssignmentID)
		if err != nil {
			return nil, pipelineStepResult{}, mustJSON(input), err
		}
		prompt := markdownFromImagePrompt()
		input["image_path"] = image.StoredPath
		input["mime_type"] = image.MimeType
		input["prompt"] = prompt
		resp, err = s.provider.ConvertAssignmentImageToMarkdown(ctx, llm.ConvertAssignmentImageToMarkdownRequest{
			ImagePath:     s.storage.FullPath(image.StoredPath),
			MimeType:      image.MimeType,
			Prompt:        prompt,
			PromptVersion: PromptVersion,
		})
	case 2:
		markdown := resultContent(results, "markdown")
		if markdown == "" {
			return nil, pipelineStepResult{}, mustJSON(input), errors.New("step 1 result is missing")
		}
		prompt := parametersPrompt(markdown)
		input["prompt"] = prompt
		resp, err = s.provider.GenerateAssignmentText(ctx, llm.GenerateAssignmentTextRequest{
			Prompt:        prompt,
			PromptVersion: PromptVersion,
		})
	case 3:
		markdown := resultContent(results, "markdown")
		parameters := resultContent(results, "parameters")
		if markdown == "" || parameters == "" {
			return nil, pipelineStepResult{}, mustJSON(input), errors.New("previous pipeline results are missing")
		}
		prompt := variationRulesPrompt(markdown, parameters)
		input["prompt"] = prompt
		resp, err = s.provider.GenerateAssignmentText(ctx, llm.GenerateAssignmentTextRequest{
			Prompt:        prompt,
			PromptVersion: PromptVersion,
		})
	case 4:
		markdown := resultContent(results, "markdown")
		parameters := resultContent(results, "parameters")
		variationRules := resultContent(results, "variation_rules")
		if markdown == "" || parameters == "" || variationRules == "" {
			return nil, pipelineStepResult{}, mustJSON(input), errors.New("previous pipeline results are missing")
		}
		prompt := variantPrompt(markdown, parameters, variationRules)
		input["prompt"] = prompt
		resp, err = s.provider.GenerateAssignmentText(ctx, llm.GenerateAssignmentTextRequest{
			Prompt:        prompt,
			PromptVersion: PromptVersion,
		})
	default:
		return nil, pipelineStepResult{}, mustJSON(input), fmt.Errorf("unsupported pipeline step %d", step)
	}
	if err != nil {
		return resp, pipelineStepResult{}, mustJSON(input), err
	}

	content := normalizeLLMText(resp.Content)
	result := pipelineStepResult{
		Step:      step,
		Key:       pipelineStepKey(step),
		Title:     pipelineStepTitle(step),
		Content:   content,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	return resp, result, mustJSON(input), nil
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

func buildPipelineContent(results []pipelineStepResult) pipelineContent {
	return pipelineContent{
		Markdown:        resultContent(results, "markdown"),
		Parameters:      resultContent(results, "parameters"),
		VariationRules:  resultContent(results, "variation_rules"),
		VariantMarkdown: resultContent(results, "variant_markdown"),
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

func pipelineStepKey(step int) string {
	switch step {
	case 1:
		return "markdown"
	case 2:
		return "parameters"
	case 3:
		return "variation_rules"
	case 4:
		return "variant_markdown"
	default:
		return "unknown"
	}
}

func pipelineStepTitle(step int) string {
	switch step {
	case 1:
		return "Markdown исходного задания"
	case 2:
		return "Параметры задания"
	case 3:
		return "Допустимые изменения"
	case 4:
		return "Новый вариант задания"
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

func markdownFromImagePrompt() string {
	return `Я отправляю тебе школьное задание. Преобразуй его в markdown.

В качестве ответа пришли только содержимое md файла без дополнительного текста и без твоих комментариев.
Решать и изменять задание не нужно.
Оформи ответ в виде блока кода с использованием triple backticks в начале и в конце, чтобы было проще скопировать эти данные.`
}

func parametersPrompt(markdown string) string {
	return `Я отправляю тебе задание в виде markdown файла. По данным из файла определи параметры, которые я опишу ниже. Выбери один вариант из списка возможных значений, если они указаны. Если значение параметра определить не удалось, используй "*".

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

<результат step1>
` + markdown + `
</результат step1>`
}

func variationRulesPrompt(markdown, parameters string) string {
	return `Я отправляю тебе задание в виде markdown файла. Необходимо на его основе создать ещё один новый вариант такого же задания за счет допустимых изменений. Было определено, что это задание имеет следующие параметры:

<результат step2>
` + parameters + `
</результат step2>

Допустимый характер вариации (можно выбрать несколько): замена числовых данных (диапазон, тип чисел — целые, десятичные, дроби), изменение порядка перечисления (список условий, объектов, действий), синонимическая замена неключевых формулировок, замена контекста (ситуации, примеры) при сохранении логики, изменение имён, названий, единиц измерения (без изменения сложности), перестановка шагов в многошаговой инструкции.

В качестве ответа пришли только список допустимых вариаций изменений этого задания без дополнительного текста и без твоих комментариев.

Пример ответа:
замена числовых данных (диапазон, тип чисел — целые, десятичные, дроби), перестановка шагов в многошаговой инструкции

<результат step1>
` + markdown + `
</результат step1>`
}

func variantPrompt(markdown, parameters, variationRules string) string {
	return `Я отправляю тебе задание в виде markdown файла. Необходимо на его основе создать ещё один новый вариант такого же задания. Было определено, что это задание имеет следующие параметры:

<результат step2>
` + parameters + `
</результат step2>

Определи части задания, которые можно изменять, а какие нельзя, например формулировка задания, нумерация, индексы букв и пр., чтобы избежать нарушения логики.

Также определено, что нельзя менять следующий текст (если тут стоит "-", то изменения допустимы на твое усмотрение):
-

Допустимые изменения в задании для создания нового варианта:
` + variationRules + `

В качестве ответа пришли только содержимое md файла нового варианта без дополнительного текста и без твоих комментариев. Решать задания не нужно. Оформи ответ в виде блока кода с использованием triple backticks в начале и в конце, чтобы было проще скопировать эти данные.

<результат step1>
` + markdown + `
</результат step1>`
}
