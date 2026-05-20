package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"teacher-assistant/backend/internal/db"
	"teacher-assistant/backend/internal/extraction"
)

func (s *Server) getExtractionRun(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runID")
	run, err := s.store.GetExtractionRun(r.Context(), runID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "extraction_not_found", "Extraction run was not found.")
			return
		}
		s.logger.Error("failed to get extraction run", "run_id", runID, "error", err)
		writeInternalError(w)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

type updateStepRequest struct {
	Content string `json:"content"`
}

type continueExtractionRequest struct {
	FinalModel string `json:"final_model"`
}

func (s *Server) updateExtractionStep(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runID")
	step, err := strconv.Atoi(chi.URLParam(r, "step"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_step", "Step is invalid.")
		return
	}
	var body updateStepRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	run, err := s.extraction.UpdateStep(r.Context(), runID, step, body.Content)
	if err != nil {
		writeExtractionActionError(w, s, runID, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (s *Server) regenerateExtractionStep(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runID")
	step, err := strconv.Atoi(chi.URLParam(r, "step"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_step", "Step is invalid.")
		return
	}
	run, err := s.extraction.Regenerate(r.Context(), runID, step)
	if err != nil {
		writeExtractionActionError(w, s, runID, err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"extraction_run_id": run.ID,
		"status":            "running",
		"step":              step,
	})
}

func writeExtractionActionError(w http.ResponseWriter, s *Server, runID string, err error) {
	if errors.Is(err, db.ErrNotFound) {
		writeError(w, http.StatusNotFound, "extraction_not_found", "Extraction run was not found.")
		return
	}
	if errors.Is(err, extraction.ErrPipelineNotReady) {
		writeError(w, http.StatusBadRequest, "pipeline_not_ready", "Pipeline is not ready for this action.")
		return
	}
	if errors.Is(err, extraction.ErrInvalidPipelineStep) {
		writeError(w, http.StatusBadRequest, "invalid_step", "Step or content is invalid.")
		return
	}
	s.logger.Error("failed to update extraction run", "run_id", runID, "error", err)
	writeInternalError(w)
}

func (s *Server) continueExtractionRun(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runID")
	var body continueExtractionRequest
	if r.Body != nil {
		_ = json.NewDecoder(r.Body).Decode(&body)
	}
	run, err := s.extraction.Continue(r.Context(), runID, extraction.ContinueOptions{
		FinalModel: body.FinalModel,
	})
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "extraction_not_found", "Extraction run was not found.")
			return
		}
		if errors.Is(err, extraction.ErrPipelineNotReady) {
			writeError(w, http.StatusBadRequest, "pipeline_not_ready", "Pipeline is not waiting for confirmation.")
			return
		}
		if errors.Is(err, extraction.ErrInvalidFinalModel) {
			writeError(w, http.StatusBadRequest, "invalid_final_model", "Final model must be lite or pro.")
			return
		}
		s.logger.Error("failed to continue extraction run", "run_id", runID, "error", err)
		writeInternalError(w)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{
		"extraction_run_id": run.ID,
		"status":            "running",
		"next_step":         run.CurrentStep + 1,
	})
}
