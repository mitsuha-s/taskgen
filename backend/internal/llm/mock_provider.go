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
	content := `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>English Grammar Test</title>
</head>
<body>
  <h1>English Grammar Test</h1>
  <h2>Task 1</h2>
  <p>Choose the correct answer.</p>
  <ol>
    <li>She ___ to school yesterday.
      <ul><li>go</li><li>went</li><li>goes</li></ul>
    </li>
    <li>They ___ football every Sunday.
      <ul><li>plays</li><li>play</li><li>played</li></ul>
    </li>
  </ol>
  <h2>Task 2</h2>
  <p>Match the questions with the answers.</p>
  <ol>
    <li>How old are you?</li>
    <li>Where do you live?</li>
  </ol>
  <ul>
    <li>A. In London.</li>
    <li>B. I am twelve.</li>
  </ul>
</body>
</html>`

	return &TextGenerationResponse{
		RawResponse: content,
		Content:     content,
		Provider:    "mock",
		Model:       "mock-vision-v1",
	}, nil
}

func (p *MockProvider) GenerateAssignmentText(ctx context.Context, req GenerateAssignmentTextRequest) (*TextGenerationResponse, error) {
	content := "Тип задания: Множественный выбор (Multiple choice)\nПредполагаемый класс: 5\nУровень сложности задания: 3"
	if strings.Contains(req.Prompt, "создать ещё один новый вариант") {
		if strings.Contains(req.Prompt, "Match the questions") {
			content = `<h2>Task 2</h2>
<p>Match the questions with the answers.</p>
<ol>
  <li>What is your favourite subject?</li>
  <li>When do you get up?</li>
</ol>
<ul>
  <li>A. At seven o'clock.</li>
  <li>B. English.</li>
</ul>`
		} else {
			content = `<h2>Task 1</h2>
<p>Choose the correct answer.</p>
<ol>
  <li>He ___ breakfast at seven yesterday.
    <ul><li>have</li><li>had</li><li>has</li></ul>
  </li>
  <li>We ___ English on Mondays.
    <ul><li>studies</li><li>study</li><li>studied</li></ul>
  </li>
</ol>`
		}
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
