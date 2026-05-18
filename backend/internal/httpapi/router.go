package httpapi

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"teacher-assistant/backend/internal/auth"
	"teacher-assistant/backend/internal/config"
	"teacher-assistant/backend/internal/db"
	"teacher-assistant/backend/internal/extraction"
	"teacher-assistant/backend/internal/files"
)

type Server struct {
	config     config.Config
	store      *db.Store
	auth       *auth.Service
	storage    *files.LocalStorage
	extraction *extraction.Service
	logger     *slog.Logger
}

func NewRouter(cfg config.Config, store *db.Store, authService *auth.Service, storage *files.LocalStorage, extractionService *extraction.Service, logger *slog.Logger) http.Handler {
	server := &Server{
		config:     cfg,
		store:      store,
		auth:       authService,
		storage:    storage,
		extraction: extractionService,
		logger:     logger,
	}

	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(server.cors)

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	r.Route("/api", func(r chi.Router) {
		r.Post("/auth/login", server.login)

		r.Group(func(r chi.Router) {
			r.Use(server.requireAuth)
			r.Post("/auth/logout", server.logout)
			r.Get("/me", server.me)
			r.Post("/assignments", server.createAssignment)
			r.Get("/assignments/{assignmentID}", server.getAssignment)
			r.Post("/assignments/{assignmentID}/image", server.uploadAssignmentImage)
			r.Post("/assignments/{assignmentID}/extract", server.startExtraction)
			r.Get("/extraction-runs/{runID}", server.getExtractionRun)
			r.Get("/files/assignments/{assignmentID}/original", server.serveAssignmentImage)
		})
	})

	spa := newSPAHandler(cfg.FrontendDistDir)
	r.NotFound(func(w http.ResponseWriter, r *http.Request) {
		if wantsAPI(r.URL.Path) {
			writeError(w, http.StatusNotFound, "not_found", "API endpoint was not found.")
			return
		}
		spa.ServeHTTP(w, r)
	})
	r.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method is not allowed.")
	})

	return r
}

type spaHandler struct {
	root string
}

func newSPAHandler(root string) *spaHandler {
	return &spaHandler{root: root}
}

func (h *spaHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	requestedPath := filepath.Clean(r.URL.Path)
	if requestedPath == "." || requestedPath == string(filepath.Separator) {
		requestedPath = "index.html"
	}
	fullPath := filepath.Join(h.root, requestedPath)
	if info, err := os.Stat(fullPath); err == nil && !info.IsDir() {
		http.ServeFile(w, r, fullPath)
		return
	}
	http.ServeFile(w, r, filepath.Join(h.root, "index.html"))
}
