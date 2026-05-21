package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/go-chi/chi/v5"

	"teacher-assistant/backend/internal/db"
	"teacher-assistant/backend/internal/extraction"
	"teacher-assistant/backend/internal/files"
)

type createAssignmentRequest struct {
	Title string `json:"title"`
}

type startExtractionRequest struct {
	LLMProvider string `json:"llm_provider"`
}

func (s *Server) createAssignment(w http.ResponseWriter, r *http.Request) {
	var req createAssignmentRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", "Invalid JSON body.")
		return
	}

	assignment, err := s.store.CreateAssignment(r.Context(), req.Title)
	if err != nil {
		s.logger.Error("failed to create assignment", "error", err)
		writeInternalError(w)
		return
	}

	writeJSON(w, http.StatusCreated, assignment)
}

func (s *Server) getAssignment(w http.ResponseWriter, r *http.Request) {
	assignmentID := chi.URLParam(r, "assignmentID")
	assignment, err := s.store.GetAssignment(r.Context(), assignmentID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "assignment_not_found", "Assignment was not found.")
			return
		}
		s.logger.Error("failed to get assignment", "assignment_id", assignmentID, "error", err)
		writeInternalError(w)
		return
	}

	var image *imageResponse
	if dbImage, err := s.store.GetImageByAssignmentID(r.Context(), assignmentID); err == nil {
		image = &imageResponse{
			ID:       dbImage.ID,
			URL:      s.assignmentImageURL(assignmentID),
			MimeType: dbImage.MimeType,
			Size:     dbImage.SizeBytes,
		}
	} else if err != nil && !errors.Is(err, db.ErrNotFound) {
		s.logger.Error("failed to get assignment image", "assignment_id", assignmentID, "error", err)
		writeInternalError(w)
		return
	}

	var latestRun *runSummary
	if run, err := s.store.GetLatestExtractionRunForAssignment(r.Context(), assignmentID); err == nil {
		latestRun = &runSummary{ID: run.ID, Status: run.Status}
	} else if err != nil && !errors.Is(err, db.ErrNotFound) {
		s.logger.Error("failed to get latest extraction run", "assignment_id", assignmentID, "error", err)
		writeInternalError(w)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":                    assignment.ID,
		"title":                 assignment.Title,
		"status":                assignment.Status,
		"created_at":            assignment.CreatedAt,
		"image":                 image,
		"latest_extraction_run": latestRun,
	})
}

func (s *Server) uploadAssignmentImage(w http.ResponseWriter, r *http.Request) {
	assignmentID := chi.URLParam(r, "assignmentID")
	if _, err := s.store.GetAssignment(r.Context(), assignmentID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "assignment_not_found", "Assignment was not found.")
			return
		}
		s.logger.Error("failed to get assignment before upload", "assignment_id", assignmentID, "error", err)
		writeInternalError(w)
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, s.config.MaxUploadBytes+1024*1024)
	if err := r.ParseMultipartForm(s.config.MaxUploadBytes + 1024*1024); err != nil {
		writeError(w, http.StatusBadRequest, "file_too_large", "Image must be 10 MB or smaller.")
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "validation_error", "Image file is required.")
		return
	}
	_ = file.Close()

	saved, err := s.storage.SaveAssignmentImage(assignmentID, header, s.config.MaxUploadBytes)
	if err != nil {
		switch {
		case errors.Is(err, files.ErrInvalidFileType):
			writeError(w, http.StatusBadRequest, "invalid_file_type", "Only PNG, JPG and WEBP images are supported.")
		case errors.Is(err, files.ErrFileTooLarge):
			writeError(w, http.StatusBadRequest, "file_too_large", "Image must be 10 MB or smaller.")
		default:
			s.logger.Error("failed to save image", "assignment_id", assignmentID, "error", err)
			writeInternalError(w)
		}
		return
	}

	image, err := s.store.SaveAssignmentImage(r.Context(), assignmentID, db.ImageInput{
		OriginalFilename: header.Filename,
		StoredPath:       saved.RelativePath,
		MimeType:         saved.MimeType,
		SizeBytes:        saved.SizeBytes,
	})
	if err != nil {
		s.logger.Error("failed to save image metadata", "assignment_id", assignmentID, "error", err)
		writeInternalError(w)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"assignment_id": assignmentID,
		"image": imageResponse{
			ID:       image.ID,
			URL:      s.assignmentImageURL(assignmentID),
			MimeType: image.MimeType,
			Size:     image.SizeBytes,
		},
		"status": "image_uploaded",
	})
}

func (s *Server) startExtraction(w http.ResponseWriter, r *http.Request) {
	assignmentID := chi.URLParam(r, "assignmentID")
	var req startExtractionRequest
	if r.Body != nil {
		err := json.NewDecoder(r.Body).Decode(&req)
		if err != nil && !errors.Is(err, io.EOF) {
			writeError(w, http.StatusBadRequest, "validation_error", "Invalid JSON body.")
			return
		}
	}
	if _, err := s.store.GetAssignment(r.Context(), assignmentID); err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "assignment_not_found", "Assignment was not found.")
			return
		}
		s.logger.Error("failed to get assignment before extraction", "assignment_id", assignmentID, "error", err)
		writeInternalError(w)
		return
	}

	run, err := s.extraction.Start(r.Context(), assignmentID, extraction.StartOptions{
		Provider: req.LLMProvider,
	})
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "image_not_found", "Assignment image was not found.")
			return
		}
		if errors.Is(err, extraction.ErrInvalidProvider) {
			writeError(w, http.StatusBadRequest, "invalid_llm_provider", "LLM provider must be gigachat or openai.")
			return
		}
		s.logger.Error("failed to start extraction", "assignment_id", assignmentID, "error", err)
		writeInternalError(w)
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]any{
		"extraction_run_id": run.ID,
		"status":            run.Status,
		"provider":          run.Provider,
	})
}

type imageResponse struct {
	ID       string `json:"id"`
	URL      string `json:"url"`
	MimeType string `json:"mime_type"`
	Size     int64  `json:"size_bytes"`
}

type runSummary struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

func (s *Server) assignmentImageURL(assignmentID string) string {
	return s.config.PublicFileBaseURL + "/assignments/" + assignmentID + "/original"
}
