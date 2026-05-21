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
	content := `<section>
  <h1>English Grammar Test</h1>
  <p>Choose the correct answer.</p>
  <ol>
    <li>She ___ to school yesterday.
      <ul><li>go</li><li>went</li><li>goes</li></ul>
    </li>
    <li>They ___ football every Sunday.
      <ul><li>plays</li><li>play</li><li>played</li></ul>
    </li>
  </ol>
</section>`

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
	if strings.Contains(req.Prompt, "создать") && strings.Contains(req.Prompt, "новых вариантов") {
		content = `{"variants":[
  "<section><h1>English Grammar Test</h1><p>Choose the correct answer.</p><ol><li>He ___ breakfast at seven yesterday.<ul><li>have</li><li>had</li><li>has</li></ul></li><li>We ___ English on Mondays.<ul><li>studies</li><li>study</li><li>studied</li></ul></li></ol></section>",
  "<section><h1>English Grammar Test</h1><p>Choose the correct answer.</p><ol><li>My sister ___ TV last night.<ul><li>watch</li><li>watched</li><li>watches</li></ul></li><li>They ___ chess after class.<ul><li>plays</li><li>play</li><li>played</li></ul></li></ol></section>",
  "<section><h1>English Grammar Test</h1><p>Choose the correct answer.</p><ol><li>Tom ___ to school by bus yesterday.<ul><li>go</li><li>went</li><li>goes</li></ul></li><li>We ___ English every Thursday.<ul><li>learns</li><li>learn</li><li>learned</li></ul></li></ol></section>"
] }`
	}
	if strings.Contains(req.Prompt, "итоговую оценку") && strings.Contains(req.Prompt, "эталонный учебный вариант") {
		content = "8"
	}

	return &TextGenerationResponse{
		RawResponse: content,
		Content:     content,
		Provider:    "mock",
		Model:       "mock-text-v1",
	}, nil
}
