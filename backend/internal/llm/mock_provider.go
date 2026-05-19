package llm

import (
	"context"
	"encoding/json"
	"strings"
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
				"left_items":  nil,
				"right_items": nil,
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
				"left_items":  nil,
				"right_items": nil,
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

func (p *MockProvider) ConvertAssignmentImageToMarkdown(ctx context.Context, req ConvertAssignmentImageToMarkdownRequest) (*TextGenerationResponse, error) {
	content := `# English Grammar Test

Choose the correct answer.

1. She ___ to school yesterday.
   - go
   - went
   - goes

2. They ___ football every Sunday.
   - plays
   - play
   - played`

	return &TextGenerationResponse{
		RawResponse: content,
		Content:     content,
		Provider:    "mock",
		Model:       "mock-vision-v1",
	}, nil
}

func (p *MockProvider) GenerateAssignmentText(ctx context.Context, req GenerateAssignmentTextRequest) (*TextGenerationResponse, error) {
	content := "Предметная область: Иностранные языки\nТип задания: Множественный выбор (Multiple choice)\nПредполагаемый класс: 5\nУровень сложности задания: 3"
	if strings.Contains(req.Prompt, "Допустимый характер вариации") {
		content = "синонимическая замена неключевых формулировок, изменение порядка перечисления"
	}
	if strings.Contains(req.Prompt, "создать ещё один новый вариант") && strings.Contains(req.Prompt, "Допустимые изменения") {
		content = `# English Grammar Test

Choose the correct answer.

1. He ___ breakfast at seven yesterday.
   - have
   - had
   - has

2. We ___ English on Mondays.
   - studies
   - study
   - studied`
	}

	return &TextGenerationResponse{
		RawResponse: content,
		Content:     content,
		Provider:    "mock",
		Model:       "mock-text-v1",
	}, nil
}
