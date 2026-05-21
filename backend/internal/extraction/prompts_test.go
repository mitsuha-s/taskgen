package extraction

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadPromptSet(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, dir, "manifest.json", `{
  "version": "test_prompts_v1",
  "files": {
    "html_from_image": "step1.md",
    "parameters": "step2.md",
    "generation": "step3.md",
    "self_evaluation": "step4.md",
    "default_source": "default.html"
  }
}`)
	writeTestFile(t, dir, "step1.md", "convert image")
	writeTestFile(t, dir, "step2.md", "params: {{.TaskHTML}}")
	writeTestFile(t, dir, "step3.md", "generate {{.Params}}{{if .HasUserComment}} / {{.UserComment}}{{end}} from {{.TaskHTML}}")
	writeTestFile(t, dir, "step4.md", "score {{.SourceHTML}} vs {{.VariantHTML}}")
	writeTestFile(t, dir, "default.html", "<!doctype html>")

	prompts, err := LoadPromptSet(dir)
	if err != nil {
		t.Fatalf("LoadPromptSet returned error: %v", err)
	}
	if prompts.Version != "test_prompts_v1" {
		t.Fatalf("Version = %q", prompts.Version)
	}
	if prompts.DefaultSourceHTML() != "<!doctype html>" {
		t.Fatalf("DefaultSourceHTML = %q", prompts.DefaultSourceHTML())
	}

	parameters, err := prompts.ParametersPrompt("<h2>Task</h2>")
	if err != nil {
		t.Fatalf("ParametersPrompt returned error: %v", err)
	}
	if parameters != "params: <h2>Task</h2>" {
		t.Fatalf("ParametersPrompt = %q", parameters)
	}

	generation, err := prompts.GenerationPrompt("<h2>Task</h2>", taskParameters{
		TaskType:    "Matching",
		SchoolClass: "10",
		Difficulty:  "7",
	}, "keep topic")
	if err != nil {
		t.Fatalf("GenerationPrompt returned error: %v", err)
	}
	if !strings.Contains(generation, "Тип задания: Matching") || !strings.Contains(generation, "keep topic") {
		t.Fatalf("GenerationPrompt did not render params/comment: %q", generation)
	}
}

func TestLoadPromptSetValidatesManifest(t *testing.T) {
	dir := t.TempDir()
	writeTestFile(t, dir, "manifest.json", `{"version":"test","files":{"html_from_image":"step1.md"}}`)

	_, err := LoadPromptSet(dir)
	if err == nil {
		t.Fatal("LoadPromptSet returned nil error for incomplete manifest")
	}
	if !strings.Contains(err.Error(), "files.parameters is required") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadRepositoryPromptSet(t *testing.T) {
	dir := filepath.Join("..", "..", "..", "prompts", "task_processing_pipeline_v1")
	prompts, err := LoadPromptSet(dir)
	if err != nil {
		t.Fatalf("LoadPromptSet(%q) returned error: %v", dir, err)
	}
	if prompts.Version != "task_processing_pipeline_v1" {
		t.Fatalf("Version = %q", prompts.Version)
	}

	if _, err := prompts.HTMLFromImagePrompt(); err != nil {
		t.Fatalf("HTMLFromImagePrompt returned error: %v", err)
	}
	if _, err := prompts.ParametersPrompt("<h2>Task</h2>"); err != nil {
		t.Fatalf("ParametersPrompt returned error: %v", err)
	}
	if _, err := prompts.GenerationPrompt("<h2>Task</h2>", taskParameters{TaskType: "Matching"}, ""); err != nil {
		t.Fatalf("GenerationPrompt returned error: %v", err)
	}
	if _, err := prompts.SelfEvaluationPrompt("<html>source</html>", "<html>variant</html>"); err != nil {
		t.Fatalf("SelfEvaluationPrompt returned error: %v", err)
	}
	if prompts.DefaultSourceHTML() == "" {
		t.Fatal("DefaultSourceHTML is empty")
	}
}

func writeTestFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatalf("write test file %s: %v", name, err)
	}
}
