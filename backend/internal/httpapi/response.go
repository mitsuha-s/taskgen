package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"teacher-assistant/backend/internal/db"
)

type errorResponse struct {
	Error apiError `json:"error"`
}

type apiError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorResponse{
		Error: apiError{Code: code, Message: message},
	})
}

func writeInternalError(w http.ResponseWriter) {
	writeError(w, http.StatusInternalServerError, "internal_error", "Internal server error.")
}

func notFoundCode(err error, code string) bool {
	return errors.Is(err, db.ErrNotFound) && code != ""
}
