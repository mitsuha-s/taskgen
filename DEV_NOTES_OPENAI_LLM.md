# OpenAI LLM Work Notes

Branch: `openai-llm`

## Decisions

- Keep `redesign` as a separate branch/commit and merge it into this branch.
- Store the selected LLM provider on each `extraction_runs.provider` row so continue/regenerate use the same provider as the original run.
- Keep `mock` as the configured fallback provider for local development, but expose only `gigachat` and `openai` in the UI.
- Use OpenAI Responses API over direct Chat Completions because the official vision guide shows image input through Responses with `input_image`.
- Default OpenAI model is `gpt-4.1-mini`, matching current OpenAI vision examples; override with `OPENAI_MODEL`.
- Do not call OpenAI in verification. With no `OPENAI_API_KEY`, the provider returns `ErrProviderNotConfigured` before any HTTP request.

## Follow-ups

- Add integration tests with a fake OpenAI HTTP server before using real keys.
- Decide whether final-step model selection should be provider-specific beyond GigaChat `Lite/Pro`.
- Add a config endpoint if the UI should hide unavailable providers when keys are missing.
