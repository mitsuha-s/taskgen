package llm

import (
	"context"
	"encoding/json"
)

type MockProvider struct{}

func NewMockProvider() *MockProvider {
	return &MockProvider{}
}

func (p *MockProvider) AnalyzeAssignmentImage(ctx context.Context, req AnalyzeAssignmentImageRequest) (*AnalyzeAssignmentImageResponse, error) {
	content := map[string]any{
		"title":             "English Grammar Test",
		"subject":           "english",
		"detected_language": "en",
		"estimated_level":   "A2",
		"sections": []any{
			map[string]any{
				"id":          "section_1",
				"type":        "instruction",
				"title":       nil,
				"instruction": "Choose the correct answer.",
				"text":        nil,
				"items":       []any{},
			},
			map[string]any{
				"id":          "section_2",
				"type":        "multiple_choice",
				"title":       nil,
				"instruction": nil,
				"text":        nil,
				"items": []any{
					map[string]any{
						"id":       "item_1",
						"question": "She ___ to school yesterday.",
						"options":  []any{"go", "went", "goes"},
						"answer":   nil,
					},
					map[string]any{
						"id":       "item_2",
						"question": "They ___ football every Sunday.",
						"options":  []any{"plays", "play", "played"},
						"answer":   nil,
					},
				},
			},
		},
		"warnings": []any{},
	}
	raw, err := json.Marshal(content)
	if err != nil {
		return nil, err
	}
	return &AnalyzeAssignmentImageResponse{
		RawResponse: string(raw),
		ParsedJSON:  content,
		Provider:    "mock",
		Model:       "mock-vision-v1",
	}, nil
}
