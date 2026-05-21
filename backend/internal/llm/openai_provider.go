package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

type OpenAIConfig struct {
	APIKey  string
	Model   string
	APIBase string
	Timeout int64
}

type OpenAIProvider struct {
	apiKey  string
	model   string
	apiBase string
	client  *http.Client
}

func NewOpenAIProvider(cfg OpenAIConfig) *OpenAIProvider {
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = "gpt-4.1-mini"
	}
	apiBase := strings.TrimRight(strings.TrimSpace(cfg.APIBase), "/")
	if apiBase == "" {
		apiBase = "https://api.openai.com/v1"
	}
	timeout := cfg.Timeout
	if timeout <= 0 {
		timeout = 90
	}

	return &OpenAIProvider{
		apiKey:  strings.TrimSpace(cfg.APIKey),
		model:   model,
		apiBase: apiBase,
		client:  &http.Client{Timeout: time.Duration(timeout) * time.Second},
	}
}

func (p *OpenAIProvider) AnalyzeAssignmentImage(ctx context.Context, req AnalyzeAssignmentImageRequest) (*AnalyzeAssignmentImageResponse, error) {
	if strings.TrimSpace(p.apiKey) == "" {
		return &AnalyzeAssignmentImageResponse{
			Provider: "openai",
			Model:    p.model,
		}, ErrProviderNotConfigured
	}

	imageURL, err := dataURLFromFile(req.ImagePath, req.MimeType)
	if err != nil {
		return &AnalyzeAssignmentImageResponse{
			Provider: "openai",
			Model:    p.model,
		}, err
	}

	raw, content, err := p.responses(ctx, map[string]any{
		"model":        p.model,
		"instructions": systemPrompt(req.PromptVersion),
		"input": []map[string]any{
			{
				"role": "user",
				"content": []map[string]any{
					{"type": "input_text", "text": "Analyze the attached image and return only the assignment JSON object."},
					{"type": "input_image", "image_url": imageURL},
				},
			},
		},
	})
	if err != nil {
		return &AnalyzeAssignmentImageResponse{
			RawResponse: raw,
			Provider:    "openai",
			Model:       p.model,
		}, err
	}

	parsed, err := parseJSONObject(content)
	if err != nil {
		return &AnalyzeAssignmentImageResponse{
			RawResponse: raw,
			Provider:    "openai",
			Model:       p.model,
		}, err
	}
	return &AnalyzeAssignmentImageResponse{
		RawResponse: raw,
		ParsedJSON:  parsed,
		Provider:    "openai",
		Model:       p.model,
	}, nil
}

func (p *OpenAIProvider) ConvertAssignmentImageToMarkdown(ctx context.Context, req ConvertAssignmentImageToMarkdownRequest) (*TextGenerationResponse, error) {
	if strings.TrimSpace(p.apiKey) == "" {
		return &TextGenerationResponse{
			Provider: "openai",
			Model:    p.model,
		}, ErrProviderNotConfigured
	}

	imageURL, err := dataURLFromFile(req.ImagePath, req.MimeType)
	if err != nil {
		return &TextGenerationResponse{
			Provider: "openai",
			Model:    p.model,
		}, err
	}

	raw, content, err := p.responses(ctx, map[string]any{
		"model":        p.model,
		"instructions": "You convert school assignment images into faithful markdown. Return only the requested content.",
		"input": []map[string]any{
			{
				"role": "user",
				"content": []map[string]any{
					{"type": "input_text", "text": req.Prompt},
					{"type": "input_image", "image_url": imageURL},
				},
			},
		},
	})
	if err != nil {
		return &TextGenerationResponse{
			RawResponse: raw,
			Provider:    "openai",
			Model:       p.model,
		}, err
	}
	return &TextGenerationResponse{
		RawResponse: raw,
		Content:     content,
		Provider:    "openai",
		Model:       p.model,
	}, nil
}

func (p *OpenAIProvider) GenerateAssignmentText(ctx context.Context, req GenerateAssignmentTextRequest) (*TextGenerationResponse, error) {
	model := strings.TrimSpace(req.Model)
	if model == "" {
		model = p.model
	}
	if strings.TrimSpace(p.apiKey) == "" {
		return &TextGenerationResponse{
			Provider: "openai",
			Model:    model,
		}, ErrProviderNotConfigured
	}

	raw, content, err := p.responses(ctx, map[string]any{
		"model":        model,
		"instructions": "You process school assignments according to the user instructions. Return only the requested content.",
		"input":        req.Prompt,
	})
	if err != nil {
		return &TextGenerationResponse{
			RawResponse: raw,
			Provider:    "openai",
			Model:       model,
		}, err
	}
	return &TextGenerationResponse{
		RawResponse: raw,
		Content:     content,
		Provider:    "openai",
		Model:       model,
	}, nil
}

func (p *OpenAIProvider) responses(ctx context.Context, payload map[string]any) (string, string, error) {
	body, err := json.Marshal(payload)
	if err != nil {
		return "", "", err
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.apiBase+"/responses", bytes.NewReader(body))
	if err != nil {
		return "", "", err
	}
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return "", "", fmt.Errorf("openai response request failed: %w", err)
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	raw := string(respBody)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return raw, "", fmt.Errorf("openai response failed: status %d: %s", resp.StatusCode, raw)
	}

	content, err := parseOpenAIOutputText(respBody)
	if err != nil {
		return raw, "", err
	}
	return raw, content, nil
}

func dataURLFromFile(path, mimeType string) (string, error) {
	mimeType = strings.TrimSpace(mimeType)
	if mimeType == "" {
		return "", errors.New("image mime type is required")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}

func parseOpenAIOutputText(respBody []byte) (string, error) {
	var parsed struct {
		OutputText string `json:"output_text"`
		Output     []struct {
			Type    string `json:"type"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"output"`
	}
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return "", fmt.Errorf("openai response returned invalid JSON: %w", err)
	}
	if strings.TrimSpace(parsed.OutputText) != "" {
		return parsed.OutputText, nil
	}

	var builder strings.Builder
	for _, output := range parsed.Output {
		if output.Type != "" && output.Type != "message" {
			continue
		}
		for _, content := range output.Content {
			if content.Text == "" {
				continue
			}
			if builder.Len() > 0 {
				builder.WriteString("\n")
			}
			builder.WriteString(content.Text)
		}
	}
	result := strings.TrimSpace(builder.String())
	if result == "" {
		return "", errors.New("openai response returned empty content")
	}
	return result, nil
}
