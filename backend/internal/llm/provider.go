package llm

import (
	"context"
	"errors"
	"strings"
)

type VisionProvider interface {
	AnalyzeAssignmentImage(ctx context.Context, req AnalyzeAssignmentImageRequest) (*AnalyzeAssignmentImageResponse, error)
	ConvertAssignmentImageToMarkdown(ctx context.Context, req ConvertAssignmentImageToMarkdownRequest) (*TextGenerationResponse, error)
	GenerateAssignmentText(ctx context.Context, req GenerateAssignmentTextRequest) (*TextGenerationResponse, error)
}

type AnalyzeAssignmentImageRequest struct {
	ImagePath     string
	MimeType      string
	PromptVersion string
}

type ConvertAssignmentImageToMarkdownRequest struct {
	ImagePath     string
	MimeType      string
	Prompt        string
	PromptVersion string
}

type GenerateAssignmentTextRequest struct {
	Prompt        string
	PromptVersion string
	Model         string
}

type AnalyzeAssignmentImageResponse struct {
	RawResponse string
	ParsedJSON  map[string]any
	Provider    string
	Model       string
}

type TextGenerationResponse struct {
	RawResponse string
	Content     string
	Provider    string
	Model       string
}

type ProviderConfig struct {
	Name              string
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
}

type ProviderRegistry struct {
	defaultName string
	providers   map[string]VisionProvider
}

func NewProviderRegistry(cfg ProviderConfig) *ProviderRegistry {
	defaultName := NormalizeProviderName(cfg.Name)
	if defaultName == "" {
		defaultName = "mock"
	}

	return &ProviderRegistry{
		defaultName: defaultName,
		providers: map[string]VisionProvider{
			"mock": NewMockProvider(),
			"gigachat": NewGigaChatProvider(GigaChatConfig{
				AuthKey:   cfg.GigaChatAuthKey,
				Model:     cfg.GigaChatModel,
				TextModel: cfg.GigaChatTextModel,
				Scope:     cfg.GigaChatScope,
				AuthURL:   cfg.GigaChatAuthURL,
				APIBase:   cfg.GigaChatAPIBase,
				VerifyTLS: cfg.GigaChatVerifyTLS,
				Timeout:   cfg.GigaChatTimeout,
			}),
			"openai": NewOpenAIProvider(OpenAIConfig{
				APIKey:  cfg.OpenAIAPIKey,
				Model:   cfg.OpenAIModel,
				APIBase: cfg.OpenAIAPIBase,
				Timeout: cfg.OpenAITimeout,
			}),
		},
	}
}

func NewProvider(cfg ProviderConfig) VisionProvider {
	provider, _, err := NewProviderRegistry(cfg).Resolve(cfg.Name)
	if err != nil {
		return NewMockProvider()
	}
	return provider
}

func (r *ProviderRegistry) Resolve(name string) (VisionProvider, string, error) {
	selected := NormalizeProviderName(name)
	if selected == "" {
		selected = r.defaultName
	}
	provider, ok := r.providers[selected]
	if !ok {
		return nil, "", ErrUnknownProvider
	}
	return provider, selected, nil
}

func NormalizeProviderName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

var ErrProviderNotConfigured = errors.New("vision provider is not configured")
var ErrUnknownProvider = errors.New("unknown vision provider")
