package httpapi

import (
	"errors"
	"net/http"

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

func (s *Server) continueExtractionRun(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runID")
	run, err := s.extraction.Continue(r.Context(), runID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "extraction_not_found", "Extraction run was not found.")
			return
		}
		if errors.Is(err, extraction.ErrPipelineNotReady) {
			writeError(w, http.StatusBadRequest, "pipeline_not_ready", "Pipeline is not waiting for confirmation.")
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
