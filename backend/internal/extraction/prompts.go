package extraction

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"text/template"
)

const DefaultPromptSetDir = "prompts/task_processing_pipeline_v1"

type PromptSet struct {
	Version           string
	Dir               string
	htmlFromImage     *template.Template
	parameters        *template.Template
	generation        *template.Template
	selfEvaluation    *template.Template
	defaultSourceHTML string
}

type promptSetManifest struct {
	Version string         `json:"version"`
	Files   promptSetFiles `json:"files"`
}

type promptSetFiles struct {
	HTMLFromImage  string `json:"html_from_image"`
	Parameters     string `json:"parameters"`
	Generation     string `json:"generation"`
	SelfEvaluation string `json:"self_evaluation"`
	DefaultSource  string `json:"default_source"`
}

type generationPromptData struct {
	TaskHTML       string
	Params         string
	UserComment    string
	HasUserComment bool
}

func LoadPromptSet(dir string) (*PromptSet, error) {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		dir = DefaultPromptSetDir
	}

	manifestPath := filepath.Join(dir, "manifest.json")
	data, err := os.ReadFile(manifestPath)
	if err != nil {
		return nil, fmt.Errorf("read prompt manifest %q: %w", manifestPath, err)
	}

	var manifest promptSetManifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("parse prompt manifest %q: %w", manifestPath, err)
	}
	if strings.TrimSpace(manifest.Version) == "" {
		return nil, fmt.Errorf("prompt manifest %q has empty version", manifestPath)
	}
	if err := manifest.Files.validate(); err != nil {
		return nil, fmt.Errorf("prompt manifest %q: %w", manifestPath, err)
	}

	defaultSourceHTML, err := readPromptFile(dir, manifest.Files.DefaultSource)
	if err != nil {
		return nil, err
	}
	htmlFromImage, err := parsePromptTemplate(dir, "html_from_image", manifest.Files.HTMLFromImage)
	if err != nil {
		return nil, err
	}
	parameters, err := parsePromptTemplate(dir, "parameters", manifest.Files.Parameters)
	if err != nil {
		return nil, err
	}
	generation, err := parsePromptTemplate(dir, "generation", manifest.Files.Generation)
	if err != nil {
		return nil, err
	}
	selfEvaluation, err := parsePromptTemplate(dir, "self_evaluation", manifest.Files.SelfEvaluation)
	if err != nil {
		return nil, err
	}

	return &PromptSet{
		Version:           strings.TrimSpace(manifest.Version),
		Dir:               dir,
		htmlFromImage:     htmlFromImage,
		parameters:        parameters,
		generation:        generation,
		selfEvaluation:    selfEvaluation,
		defaultSourceHTML: defaultSourceHTML,
	}, nil
}

func (f promptSetFiles) validate() error {
	if strings.TrimSpace(f.HTMLFromImage) == "" {
		return fmt.Errorf("files.html_from_image is required")
	}
	if strings.TrimSpace(f.Parameters) == "" {
		return fmt.Errorf("files.parameters is required")
	}
	if strings.TrimSpace(f.Generation) == "" {
		return fmt.Errorf("files.generation is required")
	}
	if strings.TrimSpace(f.SelfEvaluation) == "" {
		return fmt.Errorf("files.self_evaluation is required")
	}
	if strings.TrimSpace(f.DefaultSource) == "" {
		return fmt.Errorf("files.default_source is required")
	}
	return nil
}

func parsePromptTemplate(dir, name, filename string) (*template.Template, error) {
	content, err := readPromptFile(dir, filename)
	if err != nil {
		return nil, err
	}
	tpl, err := template.New(name).Option("missingkey=error").Parse(content)
	if err != nil {
		return nil, fmt.Errorf("parse prompt template %q: %w", filepath.Join(dir, filename), err)
	}
	return tpl, nil
}

func readPromptFile(dir, filename string) (string, error) {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return "", fmt.Errorf("prompt filename is empty")
	}
	path := filepath.Join(dir, filename)
	data, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("read prompt file %q: %w", path, err)
	}
	return strings.TrimRight(string(data), "\n"), nil
}

func (p *PromptSet) HTMLFromImagePrompt() (string, error) {
	return executePromptTemplate(p.htmlFromImage, nil)
}

func (p *PromptSet) ParametersPrompt(taskHTML string) (string, error) {
	return executePromptTemplate(p.parameters, map[string]string{"TaskHTML": taskHTML})
}

func (p *PromptSet) GenerationPrompt(taskHTML string, params taskParameters, userComment string) (string, error) {
	userComment = strings.TrimSpace(userComment)
	return executePromptTemplate(p.generation, generationPromptData{
		TaskHTML:       taskHTML,
		Params:         formatTaskParameters(params),
		UserComment:    userComment,
		HasUserComment: userComment != "",
	})
}

func (p *PromptSet) SelfEvaluationPrompt(sourceHTML, variantHTML string) (string, error) {
	return executePromptTemplate(p.selfEvaluation, map[string]string{
		"SourceHTML":  sourceHTML,
		"VariantHTML": variantHTML,
	})
}

func (p *PromptSet) DefaultSourceHTML() string {
	return p.defaultSourceHTML
}

func executePromptTemplate(tpl *template.Template, data any) (string, error) {
	var buf bytes.Buffer
	if err := tpl.Execute(&buf, data); err != nil {
		return "", err
	}
	return buf.String(), nil
}
