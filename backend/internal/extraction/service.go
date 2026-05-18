package extraction

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"teacher-assistant/backend/internal/db"
	"teacher-assistant/backend/internal/files"
	"teacher-assistant/backend/internal/llm"
)

type Service struct {
	store    *db.Store
	storage  *files.LocalStorage
	provider llm.VisionProvider
	logger   *slog.Logger
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

	go s.execute(run.ID)
	return run, nil
}

func (s *Service) execute(runID string) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	run, err := s.store.GetExtractionRun(ctx, runID)
	if err != nil {
		s.logger.Error("failed to load extraction run", "run_id", runID, "error", err)
		return
	}

	if err := s.store.MarkExtractionRunning(ctx, runID); err != nil {
		s.logger.Error("failed to mark extraction running", "run_id", runID, "error", err)
		return
	}

	image, err := s.store.GetImageByAssignmentID(ctx, run.AssignmentID)
	if err != nil {
		s.fail(ctx, runID, "", "", "", err.Error())
		return
	}

	requestInput, _ := json.Marshal(map[string]any{
		"assignment_id":  run.AssignmentID,
		"image_path":     image.StoredPath,
		"mime_type":      image.MimeType,
		"prompt_version": PromptVersion,
	})

	resp, err := s.provider.AnalyzeAssignmentImage(ctx, llm.AnalyzeAssignmentImageRequest{
		ImagePath:     s.storage.FullPath(image.StoredPath),
		MimeType:      image.MimeType,
		PromptVersion: PromptVersion,
	})
	if err != nil {
		provider, model := providerMeta(resp)
		rawResponse := ""
		if resp != nil {
			rawResponse = resp.RawResponse
		}
		_ = s.store.InsertLLMRun(ctx, db.LLMRunInput{
			TaskType:      "assignment_image_extraction",
			Provider:      provider,
			Model:         model,
			PromptVersion: PromptVersion,
			Input:         requestInput,
			RawOutput:     rawResponse,
			Status:        "failed",
			ErrorMessage:  err.Error(),
		})
		s.fail(ctx, runID, provider, model, rawResponse, err.Error())
		return
	}

	normalized, err := NormalizeProviderResponse(resp.ParsedJSON, resp.RawResponse)
	if err != nil {
		_ = s.store.InsertLLMRun(ctx, db.LLMRunInput{
			TaskType:      "assignment_image_extraction",
			Provider:      resp.Provider,
			Model:         resp.Model,
			PromptVersion: PromptVersion,
			Input:         requestInput,
			RawOutput:     resp.RawResponse,
			Status:        "failed",
			ErrorMessage:  err.Error(),
		})
		s.fail(ctx, runID, resp.Provider, resp.Model, resp.RawResponse, err.Error())
		return
	}

	if err := s.store.InsertLLMRun(ctx, db.LLMRunInput{
		TaskType:      "assignment_image_extraction",
		Provider:      resp.Provider,
		Model:         resp.Model,
		PromptVersion: PromptVersion,
		Input:         requestInput,
		RawOutput:     resp.RawResponse,
		ParsedOutput:  normalized.ParsedContent,
		Status:        "succeeded",
	}); err != nil {
		s.logger.Error("failed to insert llm run", "run_id", runID, "error", err)
	}

	if err := s.store.FinishExtractionSucceeded(ctx, runID, resp.Provider, resp.Model, PromptVersion, resp.RawResponse, normalized.ParsedContent, normalized.Warnings); err != nil {
		s.logger.Error("failed to finish extraction", "run_id", runID, "error", err)
	}
}

func (s *Service) fail(ctx context.Context, runID, provider, model, rawResponse, message string) {
	if err := s.store.FinishExtractionFailed(ctx, runID, provider, model, PromptVersion, rawResponse, message); err != nil {
		s.logger.Error("failed to mark extraction failed", "run_id", runID, "error", err)
	}
}

func providerMeta(resp *llm.AnalyzeAssignmentImageResponse) (string, string) {
	if resp == nil {
		return "unknown", ""
	}
	return resp.Provider, resp.Model
}
