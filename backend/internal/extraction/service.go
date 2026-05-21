package extraction

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"
	"time"

	"teacher-assistant/backend/internal/db"
	"teacher-assistant/backend/internal/files"
	"teacher-assistant/backend/internal/llm"
)

const totalPipelineSteps = 4
const generationStep = 3
const evaluationStep = 4

var scorePattern = regexp.MustCompile(`\b(10|[1-9])\b`)

var ErrPipelineNotReady = errors.New("pipeline is not waiting for confirmation")
var ErrInvalidPipelineStep = errors.New("invalid pipeline step")
var ErrInvalidFinalModel = errors.New("invalid final model")
var ErrInvalidVariantCount = errors.New("invalid variant count")

type Service struct {
	store    *db.Store
	storage  *files.LocalStorage
	provider llm.VisionProvider
	prompts  *PromptSet
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
	VariantHTML     string               `json:"variant_html,omitempty"`
	VariantsHTML    []string             `json:"variants_html,omitempty"`
	SelectedVariant int                  `json:"selected_variant,omitempty"`
	SelfScore       string               `json:"self_score,omitempty"`
	UsedDefaultHTML bool                 `json:"used_default_html,omitempty"`
	Steps           []pipelineStepResult `json:"steps"`
}

type taskParameters struct {
	TaskNumber  int    `json:"task_number"`
	Heading     string `json:"heading"`
	TaskType    string `json:"task_type"`
	SchoolClass string `json:"school_class"`
	Difficulty  string `json:"difficulty"`
}

type parameterBundle struct {
	Tasks       []taskParameters `json:"tasks"`
	UserComment string           `json:"user_comment,omitempty"`
}

type taskSection struct {
	Number  int
	Heading string
	HTML    string
	Start   int
	End     int
}

func NewService(store *db.Store, storage *files.LocalStorage, provider llm.VisionProvider, prompts *PromptSet, logger *slog.Logger) *Service {
	return &Service{store: store, storage: storage, provider: provider, prompts: prompts, logger: logger}
}

func (s *Service) Start(ctx context.Context, assignmentID string, options StartOptions) (db.ExtractionRun, error) {
	if !options.UseDefaultSource {
		if _, err := s.store.GetImageByAssignmentID(ctx, assignmentID); err != nil {
			return db.ExtractionRun{}, err
		}
	}

	run, err := s.store.CreateExtractionRun(ctx, assignmentID, s.prompts.Version)
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
	if step == generationStep && run.Status == "succeeded" {
		if score := resultContent(parsePipelineResults(run.StepResults), "self_score"); score != "" {
			results = append(results, pipelineStepResult{
				Step:      evaluationStep,
				Key:       pipelineStepKey(evaluationStep),
				Title:     pipelineStepTitle(evaluationStep),
				Content:   score,
				CreatedAt: time.Now().UTC().Format(time.RFC3339),
			})
		}
	}
	status := "awaiting_confirmation"
	assignmentStatus := "processing_waiting"
	currentStep := step
	if step == totalPipelineSteps || (step == generationStep && run.Status == "succeeded") {
		status = "succeeded"
		assignmentStatus = "processed"
		currentStep = totalPipelineSteps
	}
	parsedContent, err := json.Marshal(buildPipelineContent(results))
	if err != nil {
		return db.ExtractionRun{}, err
	}
	stepResults, err := json.Marshal(results)
	if err != nil {
		return db.ExtractionRun{}, err
	}
	if err := s.store.UpdateExtractionStepResults(ctx, runID, status, assignmentStatus, currentStep, stepResults, parsedContent); err != nil {
		return db.ExtractionRun{}, err
	}
	if step == generationStep {
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
					_ = s.store.UpdateExtractionStepResults(ctx, runID, status, assignmentStatus, currentStep, stepResults, patched)
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
			PromptVersion: s.prompts.Version,
			Input:         input,
			RawOutput:     rawResponse,
			Status:        "failed",
			ErrorMessage:  err.Error(),
		})
		s.fail(ctx, runID, provider, model, rawResponse, err.Error())
		return
	}

	var evaluationResult *pipelineStepResult
	if step == generationStep {
		resp, result, variants, input, evaluationResult = s.evaluateAndMaybeRetry(ctx, run, results, resp, result, variants, input, finalModel, variantCount, stepModel)
	}

	results = append(results, result)
	content := buildPipelineContent(results)
	if useDefaultSource && step == 1 {
		content.UsedDefaultHTML = true
	}
	if parsedExisting := parsePipelineContent(run.ParsedContent); parsedExisting.UsedDefaultHTML {
		content.UsedDefaultHTML = true
	}
	if step == generationStep && len(variants) > 0 {
		content.VariantsHTML = variants
		content.SelectedVariant = 1
		content.VariantHTML = variants[0]
	}
	if evaluationResult != nil {
		results = append(results, *evaluationResult)
		content.SelfScore = evaluationResult.Content
		content.Steps = results
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
		PromptVersion: s.prompts.Version,
		Input:         input,
		RawOutput:     resp.RawResponse,
		ParsedOutput:  resultJSON,
		Status:        "succeeded",
	}); err != nil {
		s.logger.Error("failed to insert llm run", "run_id", runID, "step", step, "error", err)
	}

	status := "awaiting_confirmation"
	assignmentStatus := "processing_waiting"
	if step == totalPipelineSteps || step == generationStep {
		status = "succeeded"
		assignmentStatus = "processed"
	}

	if err := s.store.FinishExtractionStep(ctx, runID, db.ExtractionStepFinishInput{
		Status:           status,
		AssignmentStatus: assignmentStatus,
		Provider:         resp.Provider,
		Model:            resp.Model,
		PromptVersion:    s.prompts.Version,
		RawResponse:      resp.RawResponse,
		CurrentStep:      finishedPipelineStep(step),
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
		"prompt_version": s.prompts.Version,
	}

	switch step {
	case 1:
		if useDefaultSource {
			defaultHTML := s.prompts.DefaultSourceHTML()
			result := pipelineStepResult{
				Step:      step,
				Key:       pipelineStepKey(step),
				Title:     pipelineStepTitle(step),
				Content:   defaultHTML,
				CreatedAt: time.Now().UTC().Format(time.RFC3339),
			}
			input["use_default_source"] = true
			return &llm.TextGenerationResponse{
				RawResponse: defaultHTML,
				Content:     defaultHTML,
				Provider:    "local",
				Model:       "default-html",
			}, result, nil, mustJSON(input), nil
		}
		image, err := s.store.GetImageByAssignmentID(ctx, run.AssignmentID)
		if err != nil {
			return nil, pipelineStepResult{}, nil, mustJSON(input), err
		}
		prompt, err := s.prompts.HTMLFromImagePrompt()
		if err != nil {
			return nil, pipelineStepResult{}, nil, mustJSON(input), err
		}
		input["image_path"] = image.StoredPath
		input["mime_type"] = image.MimeType
		input["prompt"] = prompt
		resp, err = s.provider.ConvertAssignmentImageToMarkdown(ctx, llm.ConvertAssignmentImageToMarkdownRequest{
			ImagePath:     s.storage.FullPath(image.StoredPath),
			MimeType:      image.MimeType,
			Prompt:        prompt,
			PromptVersion: s.prompts.Version,
			Model:         stepModel,
		})
	case 2:
		sourceHTML := resultContent(results, "source_html")
		if sourceHTML == "" {
			return nil, pipelineStepResult{}, nil, mustJSON(input), errors.New("step 1 result is missing")
		}
		sections, splitErr := extractTaskSections(sourceHTML)
		if splitErr != nil {
			return nil, pipelineStepResult{}, nil, mustJSON(input), splitErr
		}
		tasks := make([]taskParameters, 0, len(sections))
		rawOutputs := make([]map[string]any, 0, len(sections))
		for _, section := range sections {
			prompt, promptErr := s.prompts.ParametersPrompt(section.HTML)
			if promptErr != nil {
				return nil, pipelineStepResult{}, nil, mustJSON(input), promptErr
			}
			taskResp, taskErr := s.provider.GenerateAssignmentText(ctx, llm.GenerateAssignmentTextRequest{
				Prompt:        prompt,
				PromptVersion: s.prompts.Version,
				Model:         stepModel,
			})
			if taskErr != nil {
				return taskResp, pipelineStepResult{}, nil, mustJSON(input), taskErr
			}
			params := parseTaskParameters(normalizeLLMText(taskResp.Content))
			params.TaskNumber = section.Number
			params.Heading = section.Heading
			tasks = append(tasks, params)
			rawOutputs = append(rawOutputs, map[string]any{
				"task_number": section.Number,
				"heading":     section.Heading,
				"content":     normalizeLLMText(taskResp.Content),
				"provider":    taskResp.Provider,
				"model":       taskResp.Model,
			})
			resp = taskResp
		}
		serialized := string(mustIndentJSON(parameterBundle{Tasks: tasks}))
		input["task_count"] = len(sections)
		input["tasks"] = sections
		result := pipelineStepResult{
			Step:      step,
			Key:       pipelineStepKey(step),
			Title:     pipelineStepTitle(step),
			Content:   serialized,
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		}
		return &llm.TextGenerationResponse{
			RawResponse: string(mustIndentJSON(rawOutputs)),
			Content:     serialized,
			Provider:    providerValue(resp),
			Model:       modelValue(resp, stepModel),
		}, result, nil, mustJSON(input), nil
	case 3:
		sourceHTML := resultContent(results, "source_html")
		parameters := resultContent(results, "parameters")
		if sourceHTML == "" || parameters == "" {
			return nil, pipelineStepResult{}, nil, mustJSON(input), errors.New("previous pipeline results are missing")
		}
		sections, splitErr := extractTaskSections(sourceHTML)
		if splitErr != nil {
			return nil, pipelineStepResult{}, nil, mustJSON(input), splitErr
		}
		bundle, parseErr := parseParameterBundle(parameters)
		if parseErr != nil {
			return nil, pipelineStepResult{}, nil, mustJSON(input), parseErr
		}
		if len(bundle.Tasks) != len(sections) {
			return nil, pipelineStepResult{}, nil, mustJSON(input), fmt.Errorf("expected %d task parameter sets, got %d", len(sections), len(bundle.Tasks))
		}
		model := finalModel
		if model == "" {
			model = stepModel
		}
		input["variant_count"] = variantCount
		input["task_count"] = len(sections)
		input["tasks"] = bundle.Tasks
		input["user_comment"] = bundle.UserComment
		fullVariants := make([]string, 0, variantCount)
		rawOutputs := make([]map[string]any, 0, variantCount)
		for variantIndex := 0; variantIndex < variantCount; variantIndex++ {
			generatedTasks := make([]string, 0, len(sections))
			taskOutputs := make([]map[string]any, 0, len(sections))
			for sectionIndex, section := range sections {
				params := bundle.Tasks[sectionIndex]
				prompt, promptErr := s.prompts.GenerationPrompt(section.HTML, params, bundle.UserComment)
				if promptErr != nil {
					return nil, pipelineStepResult{}, nil, mustJSON(input), promptErr
				}
				taskResp, taskErr := s.provider.GenerateAssignmentText(ctx, llm.GenerateAssignmentTextRequest{
					Prompt:        prompt,
					PromptVersion: s.prompts.Version,
					Model:         model,
				})
				if taskErr != nil {
					return taskResp, pipelineStepResult{}, nil, mustJSON(input), taskErr
				}
				taskHTML := normalizeLLMText(taskResp.Content)
				if !containsTag(taskHTML, "h2") {
					taskHTML = ensureSectionHeading(section.HTML, taskHTML)
				}
				generatedTasks = append(generatedTasks, taskHTML)
				taskOutputs = append(taskOutputs, map[string]any{
					"task_number": params.TaskNumber,
					"heading":     params.Heading,
					"content":     taskHTML,
					"provider":    taskResp.Provider,
					"model":       taskResp.Model,
				})
				resp = taskResp
			}
			fullVariant, mergeErr := mergeTaskSections(sourceHTML, sections, generatedTasks)
			if mergeErr != nil {
				return resp, pipelineStepResult{}, nil, mustJSON(input), mergeErr
			}
			fullVariants = append(fullVariants, fullVariant)
			rawOutputs = append(rawOutputs, map[string]any{
				"variant_index": variantIndex + 1,
				"tasks":         taskOutputs,
			})
		}
		result := pipelineStepResult{
			Step:      step,
			Key:       pipelineStepKey(step),
			Title:     pipelineStepTitle(step),
			Content:   fullVariants[0],
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
		}
		return &llm.TextGenerationResponse{
			RawResponse: string(mustIndentJSON(rawOutputs)),
			Content:     fullVariants[0],
			Provider:    providerValue(resp),
			Model:       modelValue(resp, model),
		}, result, fullVariants, mustJSON(input), nil
	case 4:
		sourceHTML := resultContent(results, "source_html")
		variantHTML := resultContent(results, "variant_html")
		if sourceHTML == "" || variantHTML == "" {
			return nil, pipelineStepResult{}, nil, mustJSON(input), errors.New("previous pipeline results are missing")
		}
		prompt, err := s.prompts.SelfEvaluationPrompt(sourceHTML, variantHTML)
		if err != nil {
			return nil, pipelineStepResult{}, nil, mustJSON(input), err
		}
		input["prompt"] = prompt
		resp, err = s.provider.GenerateAssignmentText(ctx, llm.GenerateAssignmentTextRequest{
			Prompt:        prompt,
			PromptVersion: s.prompts.Version,
			Model:         stepModel,
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
		content = strconv.Itoa(extractScore(content))
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

func (s *Service) evaluateAndMaybeRetry(
	ctx context.Context,
	run db.ExtractionRun,
	previousResults []pipelineStepResult,
	resp *llm.TextGenerationResponse,
	result pipelineStepResult,
	variants []string,
	input json.RawMessage,
	finalModel string,
	variantCount int,
	stepModel string,
) (*llm.TextGenerationResponse, pipelineStepResult, []string, json.RawMessage, *pipelineStepResult) {
	sourceHTML := resultContent(previousResults, "source_html")
	evaluationModel := finalModel
	if evaluationModel == "" {
		evaluationModel = stepModel
	}

	evalResp, evalResult, score, evalInput, err := s.evaluateVariant(ctx, run, sourceHTML, result.Content, evaluationModel)
	if err != nil {
		s.logger.Warn("failed to evaluate generated variant", "run_id", run.ID, "error", err)
		return resp, result, variants, input, nil
	}
	s.insertEvaluationRun(ctx, run.ID, evalResp, evalResult, evalInput)

	if score > 6 {
		return resp, result, variants, input, &evalResult
	}

	retryResp, retryResult, retryVariants, retryInput, retryErr := s.runStep(ctx, run, generationStep, previousResults, finalModel, variantCount, false, stepModel)
	if retryErr != nil {
		s.logger.Warn("failed to regenerate low-scored variant", "run_id", run.ID, "score", score, "error", retryErr)
		return resp, result, variants, input, &evalResult
	}

	retryEvalResp, retryEvalResult, _, retryEvalInput, retryEvalErr := s.evaluateVariant(ctx, run, sourceHTML, retryResult.Content, evaluationModel)
	if retryEvalErr != nil {
		s.logger.Warn("failed to evaluate regenerated variant", "run_id", run.ID, "error", retryEvalErr)
		return retryResp, retryResult, retryVariants, retryInput, nil
	}
	s.insertEvaluationRun(ctx, run.ID, retryEvalResp, retryEvalResult, retryEvalInput)
	return retryResp, retryResult, retryVariants, retryInput, &retryEvalResult
}

func (s *Service) evaluateVariant(ctx context.Context, run db.ExtractionRun, sourceHTML, variantHTML, model string) (*llm.TextGenerationResponse, pipelineStepResult, int, json.RawMessage, error) {
	prompt, err := s.prompts.SelfEvaluationPrompt(sourceHTML, variantHTML)
	if err != nil {
		return nil, pipelineStepResult{}, 0, mustJSON(map[string]any{
			"assignment_id": run.AssignmentID,
			"run_id":        run.ID,
			"step":          evaluationStep,
		}), err
	}
	input := map[string]any{
		"assignment_id":  run.AssignmentID,
		"run_id":         run.ID,
		"step":           evaluationStep,
		"prompt_version": s.prompts.Version,
		"prompt":         prompt,
	}
	resp, err := s.provider.GenerateAssignmentText(ctx, llm.GenerateAssignmentTextRequest{
		Prompt:        prompt,
		PromptVersion: s.prompts.Version,
		Model:         model,
	})
	if err != nil {
		return resp, pipelineStepResult{}, 0, mustJSON(input), err
	}

	score := extractScore(resp.Content)
	result := pipelineStepResult{
		Step:      evaluationStep,
		Key:       pipelineStepKey(evaluationStep),
		Title:     pipelineStepTitle(evaluationStep),
		Content:   strconv.Itoa(score),
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
	}
	return resp, result, score, mustJSON(input), nil
}

func (s *Service) insertEvaluationRun(ctx context.Context, runID string, resp *llm.TextGenerationResponse, result pipelineStepResult, input json.RawMessage) {
	if resp == nil {
		return
	}
	resultJSON, _ := json.Marshal(result)
	if err := s.store.InsertLLMRun(ctx, db.LLMRunInput{
		TaskType:      pipelineTaskType(evaluationStep),
		Provider:      resp.Provider,
		Model:         resp.Model,
		PromptVersion: s.prompts.Version,
		Input:         input,
		RawOutput:     resp.RawResponse,
		ParsedOutput:  resultJSON,
		Status:        "succeeded",
	}); err != nil {
		s.logger.Error("failed to insert evaluation llm run", "run_id", runID, "error", err)
	}
}

func (s *Service) fail(ctx context.Context, runID, provider, model, rawResponse, message string) {
	if err := s.store.FinishExtractionFailed(ctx, runID, provider, model, s.prompts.Version, rawResponse, message); err != nil {
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
		SourceHTML:  resultContent(results, "source_html"),
		Parameters:  resultContent(results, "parameters"),
		VariantHTML: resultContent(results, "variant_html"),
		SelfScore:   resultContent(results, "self_score"),
		Steps:       results,
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

func parseTaskParameters(content string) taskParameters {
	return taskParameters{
		TaskType:    extractLabeledValue(content, "Тип задания"),
		SchoolClass: extractLabeledValue(content, "Предполагаемый класс"),
		Difficulty:  extractLabeledValue(content, "Уровень сложности задания"),
	}
}

func parseParameterBundle(content string) (parameterBundle, error) {
	content = normalizeLLMText(content)
	var bundle parameterBundle
	if err := json.Unmarshal([]byte(content), &bundle); err != nil {
		return parameterBundle{}, fmt.Errorf("failed to parse step 2 parameters: %w", err)
	}
	if len(bundle.Tasks) == 0 {
		return parameterBundle{}, errors.New("step 2 parameters contain no tasks")
	}
	return bundle, nil
}

func formatTaskParameters(params taskParameters) string {
	return strings.Join([]string{
		"Тип задания: " + valueOrStar(params.TaskType),
		"Предполагаемый класс: " + valueOrStar(params.SchoolClass),
		"Уровень сложности задания: " + valueOrStar(params.Difficulty),
	}, "\n")
}

func extractLabeledValue(content, label string) string {
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(line), strings.ToLower(label)) {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				return strings.TrimSpace(parts[1])
			}
		}
	}
	return "*"
}

func valueOrStar(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "*"
	}
	return value
}

func extractTaskSections(sourceHTML string) ([]taskSection, error) {
	lower := strings.ToLower(sourceHTML)
	trailingStart := len(sourceHTML)
	if bodyClose := strings.LastIndex(lower, "</body>"); bodyClose >= 0 {
		trailingStart = bodyClose
	} else if htmlClose := strings.LastIndex(lower, "</html>"); htmlClose >= 0 {
		trailingStart = htmlClose
	}
	var starts []int
	searchFrom := 0
	for {
		index := strings.Index(lower[searchFrom:], "<h2")
		if index < 0 {
			break
		}
		starts = append(starts, searchFrom+index)
		searchFrom += index + 3
	}
	if len(starts) == 0 {
		return nil, errors.New("no task sections with <h2> were found in source html")
	}
	sections := make([]taskSection, 0, len(starts))
	for i, start := range starts {
		end := trailingStart
		if i+1 < len(starts) {
			end = starts[i+1]
		}
		sectionHTML := strings.TrimSpace(sourceHTML[start:end])
		sections = append(sections, taskSection{
			Number:  i + 1,
			Heading: extractTaskHeading(sectionHTML),
			HTML:    sectionHTML,
			Start:   start,
			End:     end,
		})
	}
	return sections, nil
}

func extractTaskHeading(sectionHTML string) string {
	lower := strings.ToLower(sectionHTML)
	start := strings.Index(lower, "<h2")
	if start < 0 {
		return ""
	}
	openEnd := strings.Index(lower[start:], ">")
	if openEnd < 0 {
		return ""
	}
	contentStart := start + openEnd + 1
	closeIndex := strings.Index(lower[contentStart:], "</h2>")
	if closeIndex < 0 {
		return ""
	}
	return strings.TrimSpace(stripTags(sectionHTML[contentStart : contentStart+closeIndex]))
}

func stripTags(value string) string {
	replacer := regexp.MustCompile(`(?is)<[^>]+>`)
	return strings.TrimSpace(replacer.ReplaceAllString(value, " "))
}

func mergeTaskSections(sourceHTML string, sections []taskSection, replacements []string) (string, error) {
	if len(sections) != len(replacements) {
		return "", errors.New("task replacement count does not match source task count")
	}
	var builder strings.Builder
	builder.WriteString(sourceHTML[:sections[0].Start])
	for index, section := range sections {
		builder.WriteString(strings.TrimSpace(replacements[index]))
		if index+1 < len(sections) {
			builder.WriteString(sourceHTML[section.End:sections[index+1].Start])
			continue
		}
		builder.WriteString(sourceHTML[section.End:])
	}
	return builder.String(), nil
}

func containsTag(content, tag string) bool {
	return strings.Contains(strings.ToLower(content), "<"+strings.ToLower(tag))
}

func ensureSectionHeading(originalSection, generated string) string {
	lower := strings.ToLower(originalSection)
	start := strings.Index(lower, "<h2")
	if start < 0 {
		return generated
	}
	openEnd := strings.Index(lower[start:], ">")
	if openEnd < 0 {
		return generated
	}
	closeIndex := strings.Index(lower[start+openEnd+1:], "</h2>")
	if closeIndex < 0 {
		return generated
	}
	headingHTML := originalSection[start : start+openEnd+1+closeIndex+5]
	return headingHTML + "\n" + strings.TrimSpace(generated)
}

func mustIndentJSON(value any) []byte {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return []byte("{}")
	}
	return data
}

func providerValue(resp *llm.TextGenerationResponse) string {
	if resp == nil || resp.Provider == "" {
		return "unknown"
	}
	return resp.Provider
}

func modelValue(resp *llm.TextGenerationResponse, fallback string) string {
	if resp != nil && resp.Model != "" {
		return resp.Model
	}
	return fallback
}

func extractScore(content string) int {
	content = normalizeLLMText(content)
	var parsed struct {
		Score int `json:"score"`
	}
	if err := json.Unmarshal([]byte(content), &parsed); err == nil && parsed.Score >= 1 && parsed.Score <= 10 {
		return parsed.Score
	}
	match := scorePattern.FindString(content)
	if match == "" {
		return 1
	}
	score, err := strconv.Atoi(match)
	if err != nil || score < 1 || score > 10 {
		return 1
	}
	return score
}

func finishedPipelineStep(step int) int {
	if step == generationStep {
		return evaluationStep
	}
	return step
}

func pipelineStepKey(step int) string {
	switch step {
	case 1:
		return "source_html"
	case 2:
		return "parameters"
	case 3:
		return "variant_html"
	case 4:
		return "self_score"
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
		return "Новый вариант задания (HTML)"
	case 4:
		return "Самооценка результата"
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
