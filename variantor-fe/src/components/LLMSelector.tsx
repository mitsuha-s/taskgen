import { LLMOptions, LLMSelection } from '../lib/api';
import { effectiveLLMOptions, normalizeLLMSelection } from '../lib/llm';

type LLMSelectorProps = {
  options?: LLMOptions;
  value: LLMSelection;
  onChange: (value: LLMSelection) => void;
  providerLabel?: string;
  modelLabel?: string;
  disabled?: boolean;
};

export function LLMSelector({
  options,
  value,
  onChange,
  providerLabel = 'Провайдер',
  modelLabel = 'Модель',
  disabled = false,
}: LLMSelectorProps) {
  const effective = effectiveLLMOptions(options);
  const normalized = normalizeLLMSelection(value, effective);
  const selectedProvider =
    effective.providers.find((provider) => provider.id === normalized.provider) ??
    effective.providers[0];
  const models = selectedProvider?.models ?? [];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1.5">
        <span className="label">{providerLabel}</span>
        <select
          className="field"
          value={normalized.provider}
          disabled={disabled}
          onChange={(event) => {
            const nextProvider = effective.providers.find((provider) => provider.id === event.target.value);
            onChange({
              provider: event.target.value,
              model: nextProvider?.default_model || nextProvider?.models[0]?.id || '',
            });
          }}
        >
          {effective.providers.map((provider) => (
            <option key={provider.id} value={provider.id} disabled={!provider.configured}>
              {provider.label}{provider.configured ? '' : ' (не настроен)'}
            </option>
          ))}
        </select>
      </label>
      <label className="space-y-1.5">
        <span className="label">{modelLabel}</span>
        <select
          className="field"
          value={normalized.model}
          disabled={disabled || models.length === 0}
          onChange={(event) => onChange({ provider: normalized.provider, model: event.target.value })}
        >
          {models.map((model) => (
            <option key={model.id} value={model.id}>
              {model.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
