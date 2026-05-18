package llm

import (
	"context"
	"errors"
)

type VisionProvider interface {
	AnalyzeAssignmentImage(ctx context.Context, req AnalyzeAssignmentImageRequest) (*AnalyzeAssignmentImageResponse, error)
}

type AnalyzeAssignmentImageRequest struct {
	ImagePath     string
	MimeType      string
	PromptVersion string
}

type AnalyzeAssignmentImageResponse struct {
	RawResponse string
	ParsedJSON  map[string]any
	Provider    string
	Model       string
}

type ProviderConfig struct {
	Name              string
	GigaChatAuthKey   string
	GigaChatModel     string
	GigaChatScope     string
	GigaChatAuthURL   string
	GigaChatAPIBase   string
	GigaChatVerifyTLS bool
	GigaChatTimeout   int64
}

func NewProvider(cfg ProviderConfig) VisionProvider {
	switch cfg.Name {
	case "gigachat":
		return NewGigaChatProvider(GigaChatConfig{
			AuthKey:   cfg.GigaChatAuthKey,
			Model:     cfg.GigaChatModel,
			Scope:     cfg.GigaChatScope,
			AuthURL:   cfg.GigaChatAuthURL,
			APIBase:   cfg.GigaChatAPIBase,
			VerifyTLS: cfg.GigaChatVerifyTLS,
			Timeout:   cfg.GigaChatTimeout,
		})
	default:
		return NewMockProvider()
	}
}

var ErrProviderNotConfigured = errors.New("vision provider is not configured")
