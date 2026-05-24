import { LLMOptions, LLMSelection } from './api';

export const fallbackLLMOptions: LLMOptions = {
  default_provider: 'mock',
  providers: [
    {
      id: 'mock',
      label: 'Mock',
      configured: true,
      default_model: 'mock',
      models: [{ id: 'mock', label: 'Mock' }],
    },
  ],
};

export function effectiveLLMOptions(options?: LLMOptions): LLMOptions {
  return options ?? fallbackLLMOptions;
}

export function defaultLLMSelection(options?: LLMOptions): LLMSelection {
  const effective = effectiveLLMOptions(options);
  const provider =
    effective.providers.find((item) => item.id === effective.default_provider && item.configured) ??
    effective.providers.find((item) => item.configured) ??
    effective.providers[0];

  return {
    provider: provider?.id ?? 'mock',
    model: provider?.default_model || provider?.models[0]?.id || 'mock',
  };
}

export function normalizeLLMSelection(selection: LLMSelection | undefined, options?: LLMOptions): LLMSelection {
  const effective = effectiveLLMOptions(options);
  const fallback = defaultLLMSelection(effective);
  const provider =
    effective.providers.find((item) => item.id === selection?.provider && item.configured) ??
    effective.providers.find((item) => item.id === fallback.provider) ??
    effective.providers[0];

  const selectedModel = selection?.model ?? '';
  const model = provider?.models.some((item) => item.id === selectedModel)
    ? selectedModel
    : provider?.default_model || provider?.models[0]?.id || fallback.model;

  return {
    provider: provider?.id ?? fallback.provider,
    model,
  };
}
