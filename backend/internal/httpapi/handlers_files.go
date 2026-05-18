package httpapi

import (
	"errors"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"

	"teacher-assistant/backend/internal/db"
)

func (s *Server) serveAssignmentImage(w http.ResponseWriter, r *http.Request) {
	assignmentID := chi.URLParam(r, "assignmentID")
	image, err := s.store.GetImageByAssignmentID(r.Context(), assignmentID)
	if err != nil {
		if errors.Is(err, db.ErrNotFound) {
			writeError(w, http.StatusNotFound, "image_not_found", "Assignment image was not found.")
			return
		}
		s.logger.Error("failed to get assignment image", "assignment_id", assignmentID, "error", err)
		writeInternalError(w)
		return
	}

	fullPath := s.storage.FullPath(image.StoredPath)
	file, err := os.Open(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			writeError(w, http.StatusNotFound, "image_not_found", "Assignment image file was not found.")
			return
		}
		s.logger.Error("failed to open assignment image", "assignment_id", assignmentID, "error", err)
		writeInternalError(w)
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		s.logger.Error("failed to stat assignment image", "assignment_id", assignmentID, "error", err)
		writeInternalError(w)
		return
	}

	w.Header().Set("Content-Type", image.MimeType)
	http.ServeContent(w, r, "original", stat.ModTime(), file)
}
