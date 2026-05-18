package extraction

const PromptVersion = "assignment_image_extraction_v1"

var allowedSectionTypes = map[string]struct{}{
	"instruction":     {},
	"reading_text":    {},
	"multiple_choice": {},
	"fill_gap":        {},
	"matching":        {},
	"open_question":   {},
	"unknown":         {},
}

var allowedWarningTypes = map[string]struct{}{
	"unreadable_text":       {},
	"unclear_structure":     {},
	"unsupported_task_type": {},
	"other":                 {},
}
