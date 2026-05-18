package extraction

import (
	"encoding/json"
	"errors"
	"fmt"
)

var ErrInvalidLLMResponse = errors.New("invalid llm response")

type NormalizedResult struct {
	ParsedContent json.RawMessage
	Warnings      json.RawMessage
}

func NormalizeProviderResponse(parsed map[string]any, rawResponse string) (NormalizedResult, error) {
	var content map[string]any
	if parsed != nil {
		content = cloneMap(parsed)
	} else {
		if rawResponse == "" {
			return NormalizedResult{}, fmt.Errorf("%w: empty response", ErrInvalidLLMResponse)
		}
		if err := json.Unmarshal([]byte(rawResponse), &content); err != nil {
			return NormalizedResult{}, fmt.Errorf("%w: response is not valid JSON", ErrInvalidLLMResponse)
		}
	}

	if len(content) == 0 {
		return NormalizedResult{}, fmt.Errorf("%w: empty JSON object", ErrInvalidLLMResponse)
	}

	warnings := normalizeWarnings(content["warnings"])
	content["warnings"] = warnings

	if subject, ok := content["subject"].(string); !ok || subject != "english" {
		content["subject"] = "english"
		warnings = append(warnings, warning("other", "Subject was missing or not english; normalized to english."))
		content["warnings"] = warnings
	}

	if _, ok := content["detected_language"].(string); !ok {
		content["detected_language"] = "unknown"
	}
	if _, ok := content["estimated_level"].(string); !ok {
		content["estimated_level"] = "unknown"
	}
	if _, ok := content["title"]; !ok {
		content["title"] = nil
	}

	sectionsRaw, ok := content["sections"].([]any)
	if !ok {
		return NormalizedResult{}, fmt.Errorf("%w: sections must be an array", ErrInvalidLLMResponse)
	}
	sections := make([]any, 0, len(sectionsRaw))
	for i, sectionRaw := range sectionsRaw {
		section, ok := sectionRaw.(map[string]any)
		if !ok {
			warnings = append(warnings, warning("unclear_structure", fmt.Sprintf("Section %d was not an object and was skipped.", i+1)))
			continue
		}
		section = cloneMap(section)
		if id, ok := section["id"].(string); !ok || id == "" {
			section["id"] = fmt.Sprintf("section_%d", i+1)
		}

		sectionType, _ := section["type"].(string)
		if _, ok := allowedSectionTypes[sectionType]; !ok {
			section["type"] = "unknown"
			warnings = append(warnings, warning("unsupported_task_type", fmt.Sprintf("Unsupported section type %q was normalized to unknown.", sectionType)))
		}

		for _, key := range []string{"title", "instruction", "text"} {
			if _, ok := section[key]; !ok {
				section[key] = nil
			}
		}

		itemsRaw, ok := section["items"].([]any)
		if !ok {
			itemsRaw = []any{}
		}
		items := make([]any, 0, len(itemsRaw))
		for j, itemRaw := range itemsRaw {
			item, ok := itemRaw.(map[string]any)
			if !ok {
				warnings = append(warnings, warning("unclear_structure", fmt.Sprintf("Item %d in %s was not an object and was skipped.", j+1, section["id"])))
				continue
			}
			item = cloneMap(item)
			if id, ok := item["id"].(string); !ok || id == "" {
				item["id"] = fmt.Sprintf("item_%d", j+1)
			}
			items = append(items, item)
		}
		section["items"] = items
		sections = append(sections, section)
	}
	content["sections"] = sections
	content["warnings"] = warnings

	parsedBytes, err := json.Marshal(content)
	if err != nil {
		return NormalizedResult{}, err
	}
	warningsBytes, err := json.Marshal(warnings)
	if err != nil {
		return NormalizedResult{}, err
	}
	return NormalizedResult{
		ParsedContent: parsedBytes,
		Warnings:      warningsBytes,
	}, nil
}

func normalizeWarnings(raw any) []any {
	warningsRaw, ok := raw.([]any)
	if !ok {
		return []any{}
	}

	warnings := make([]any, 0, len(warningsRaw))
	for _, warningRaw := range warningsRaw {
		entry, ok := warningRaw.(map[string]any)
		if !ok {
			continue
		}
		entry = cloneMap(entry)
		warningType, _ := entry["type"].(string)
		if _, ok := allowedWarningTypes[warningType]; !ok {
			entry["type"] = "other"
		}
		if message, ok := entry["message"].(string); !ok || message == "" {
			entry["message"] = "LLM returned an incomplete warning."
		}
		warnings = append(warnings, entry)
	}
	return warnings
}

func warning(warningType, message string) map[string]any {
	return map[string]any{"type": warningType, "message": message}
}

func cloneMap(input map[string]any) map[string]any {
	cloned := make(map[string]any, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
}
