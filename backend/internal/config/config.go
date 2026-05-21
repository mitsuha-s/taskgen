package config

import (
	"log/slog"
	"os"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv            string
	HTTPAddr          string
	DatabaseURL       string
	AuthEmail         string
	AuthPassword      string
	FileStorageDir    string
	PublicFileBaseURL string
	LLMProvider       string
	GigaChatAuthKey   string
	GigaChatModel     string
	GigaChatTextModel string
	GigaChatScope     string
	GigaChatAuthURL   string
	GigaChatAPIBase   string
	GigaChatVerifyTLS bool
	GigaChatTimeout   int64
	OpenAIAPIKey      string
	OpenAIModel       string
	OpenAIAPIBase     string
	OpenAITimeout     int64
	FrontendDistDir   string
	MigrationsDir     string
	CORSAllowedOrigin string
	MaxUploadBytes    int64
}

func Load() Config {
	if err := godotenv.Load(); err != nil && !os.IsNotExist(err) {
		slog.Warn("failed to load .env", "error", err)
	}

	return Config{
		AppEnv:            env("APP_ENV", "local"),
		HTTPAddr:          env("HTTP_ADDR", ":8080"),
		DatabaseURL:       env("DATABASE_URL", "postgres://app:app@localhost:5432/teacher_assistant?sslmode=disable"),
		AuthEmail:         env("AUTH_EMAIL", "teacher@example.com"),
		AuthPassword:      env("AUTH_PASSWORD", "secret"),
		FileStorageDir:    env("FILE_STORAGE_DIR", "./storage/uploads"),
		PublicFileBaseURL: strings.TrimRight(env("PUBLIC_FILE_BASE_URL", "/api/files"), "/"),
		LLMProvider:       env("LLM_PROVIDER", "mock"),
		GigaChatAuthKey:   env("GIGACHAT_AUTH_KEY", env("GIGACHAT_API_KEY", "")),
		GigaChatModel:     env("GIGACHAT_MODEL", "GigaChat-Pro"),
		GigaChatTextModel: env("GIGACHAT_TEXT_MODEL", ""),
		GigaChatScope:     env("GIGACHAT_SCOPE", "GIGACHAT_API_PERS"),
		GigaChatAuthURL:   env("GIGACHAT_AUTH_URL", env("GIGACHAT_OAUTH_URL", "https://ngw.devices.sberbank.ru:9443/api/v2/oauth")),
		GigaChatAPIBase:   gigachatAPIBase(),
		GigaChatVerifyTLS: envBool("GIGACHAT_VERIFY_TLS", envBool("GIGACHAT_VERIFY_SSL", true)),
		GigaChatTimeout:   envInt64("GIGACHAT_TIMEOUT", 90),
		OpenAIAPIKey:      env("OPENAI_API_KEY", ""),
		OpenAIModel:       env("OPENAI_MODEL", "gpt-4.1-mini"),
		OpenAIAPIBase:     strings.TrimRight(env("OPENAI_API_BASE_URL", "https://api.openai.com/v1"), "/"),
		OpenAITimeout:     envInt64("OPENAI_TIMEOUT", 90),
		FrontendDistDir:   env("FRONTEND_DIST_DIR", "../frontend/dist"),
		MigrationsDir:     env("MIGRATIONS_DIR", "migrations"),
		CORSAllowedOrigin: env("CORS_ALLOWED_ORIGIN", "http://localhost:5173"),
		MaxUploadBytes:    envInt64("MAX_UPLOAD_BYTES", 10*1024*1024),
	}
}

func gigachatAPIBase() string {
	base := env("GIGACHAT_API_BASE_URL", "")
	if base == "" {
		apiURL := env("GIGACHAT_API_URL", "")
		if apiURL != "" {
			base = strings.TrimSuffix(strings.TrimRight(apiURL, "/"), "/chat/completions")
		}
	}
	if base == "" {
		base = "https://gigachat.devices.sberbank.ru/api/v1"
	}
	return strings.TrimRight(base, "/")
}

func (c Config) CookieSecure() bool {
	return c.AppEnv != "local"
}

func env(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func envBool(key string, fallback bool) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if raw == "" {
		return fallback
	}
	switch raw {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return fallback
	}
}

func envInt64(key string, fallback int64) int64 {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
