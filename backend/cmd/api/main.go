package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"teacher-assistant/backend/internal/auth"
	"teacher-assistant/backend/internal/config"
	"teacher-assistant/backend/internal/db"
	"teacher-assistant/backend/internal/extraction"
	"teacher-assistant/backend/internal/files"
	"teacher-assistant/backend/internal/httpapi"
	"teacher-assistant/backend/internal/llm"
)

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{}))
	cfg := config.Load()

	if err := os.MkdirAll(cfg.FileStorageDir, 0o755); err != nil {
		logger.Error("failed to create storage directory", "error", err)
		os.Exit(1)
	}

	if err := db.RunMigrations(cfg.DatabaseURL, cfg.MigrationsDir); err != nil {
		logger.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	store, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Error("failed to connect database", "error", err)
		os.Exit(1)
	}
	defer store.Close()

	storage := files.NewLocalStorage(cfg.FileStorageDir)
	authService := auth.NewService(cfg.AuthEmail, cfg.AuthPassword, cfg.CookieSecure())
	visionProvider := llm.NewProvider(llm.ProviderConfig{
		Name:              cfg.LLMProvider,
		GigaChatAuthKey:   cfg.GigaChatAuthKey,
		GigaChatModel:     cfg.GigaChatModel,
		GigaChatTextModel: cfg.GigaChatTextModel,
		GigaChatScope:     cfg.GigaChatScope,
		GigaChatAuthURL:   cfg.GigaChatAuthURL,
		GigaChatAPIBase:   cfg.GigaChatAPIBase,
		GigaChatVerifyTLS: cfg.GigaChatVerifyTLS,
		GigaChatTimeout:   cfg.GigaChatTimeout,
	})
	extractionService := extraction.NewService(store, storage, visionProvider, logger)
	router := httpapi.NewRouter(cfg, store, authService, storage, extractionService, logger)

	server := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		logger.Info("starting api server", "addr", cfg.HTTPAddr)
		errCh <- server.ListenAndServe()
	}()

	stopCh := make(chan os.Signal, 1)
	signal.Notify(stopCh, syscall.SIGINT, syscall.SIGTERM)

	select {
	case sig := <-stopCh:
		logger.Info("shutdown signal received", "signal", sig.String())
	case err := <-errCh:
		if err != nil && err != http.ErrServerClosed {
			logger.Error("server failed", "error", err)
			os.Exit(1)
		}
	}

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("server shutdown failed", "error", err)
		os.Exit(1)
	}
}
