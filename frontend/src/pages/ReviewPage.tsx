import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, CheckCircle2, Download, FileText, Loader2, Plus, RotateCcw, Save, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, PipelineStepResult, userMessage } from '../lib/api';

const totalSteps = 4;

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runId = searchParams.get('run');
  const [stepModels, setStepModels] = useState<Record<number, 'lite' | 'pro'>>({
    1: 'pro',
    2: 'pro',
    3: 'pro',
    4: 'pro',
  });
  const [variantCount, setVariantCount] = useState(3);

  const assignment = useQuery({
    queryKey: ['assignment', id],
    queryFn: () => api.getAssignment(id!),
    enabled: Boolean(id),
  });

  const run = useQuery({
    queryKey: ['extraction-run', runId],
    queryFn: () => api.getExtractionRun(runId!),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'pending' || status === 'running' ? 1200 : false;
    },
  });

  const restart = useMutation({
    mutationFn: () => api.startExtraction(id!),
    onSuccess: (result) => {
      navigate(`/assignments/${id}/review?run=${result.extraction_run_id}`, { replace: true });
    },
  });

  const continueRun = useMutation({
    mutationFn: (options?: { final_model?: 'lite' | 'pro'; variant_count?: number; step_model?: 'lite' | 'pro' }) =>
      api.continueExtractionRun(runId!, options),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['extraction-run', runId] });
    },
  });
  const updateStep = useMutation({
    mutationFn: ({ step, content }: { step: number; content: string }) =>
      api.updateExtractionStep(runId!, step, content),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['extraction-run', runId] });
    },
  });
  const regenerateStep = useMutation({
    mutationFn: (step: number) => api.regenerateExtractionStep(runId!, step),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['extraction-run', runId] });
    },
  });

  const data = run.data;
  const steps = data?.parsed_content?.steps ?? data?.step_results ?? [];
  const sourceHTML = data?.parsed_content?.source_html ?? steps.find((step) => step.key === 'source_html')?.content ?? '';
  const finalHTML = data?.parsed_content?.variant_html ?? steps.find((step) => step.key === 'variant_html')?.content ?? '';
  const variantsHTML = data?.parsed_content?.variants_html ?? (finalHTML ? [finalHTML] : []);
  const selectedVariant = data?.parsed_content?.selected_variant ?? 1;
  const isRunning = data?.status === 'pending' || data?.status === 'running' || run.isLoading;
  const canContinue = data?.status === 'awaiting_confirmation' && data.current_step < totalSteps;
  const imageURL = assignment.data?.image?.url;

  if (!id || !runId) {
    return (
      <div className="panel p-5 text-sm text-red-700">
        Не хватает параметров задания или запуска обработки.
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 rounded-xl bg-[linear-gradient(135deg,rgba(255,255,255,0.9),rgba(231,229,255,0.72),rgba(223,247,255,0.66))] p-5 shadow-sm ring-1 ring-white/80 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#266f85,#5b7cfa_58%,#ff8a7a)] text-white shadow-sm shadow-leaf/20">
              <FileText className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink">Пайплайн обработки задания</h1>
              <p className="mt-1 text-sm text-slate-600">{assignment.data?.title || 'Эталонное задание'}</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-[linear-gradient(135deg,#e7e5ff,#dff7ff)] px-3 py-1 text-xs font-semibold text-leaf">Шаг {data?.current_step ?? 1} из {totalSteps}</span>
            <span className="rounded-full bg-[linear-gradient(135deg,#fff7ed,#ffffff)] px-3 py-1 text-xs font-semibold text-slate-700">{statusLabel(data?.status ?? 'loading')}</span>
          </div>
        </div>
        <Link className="btn-secondary" to="/assignments/new">
          Новое задание
        </Link>
      </div>

      {(assignment.isError || run.isError) && (
        <div className="panel border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {userMessage(assignment.error ?? run.error)}
        </div>
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(520px,0.95fr)_minmax(520px,1.05fr)] 2xl:grid-cols-[minmax(640px,0.9fr)_minmax(720px,1.1fr)]">
        <div className="panel overflow-hidden">
          <div className="section-title">Оригинальное изображение</div>
          <div className="flex min-h-[560px] items-center justify-center bg-[linear-gradient(135deg,#fff7ed,#f7f5ff_48%,#e9fbff)] p-4 2xl:min-h-[680px]">
            {imageURL ? (
              <a href={imageURL} target="_blank" rel="noreferrer" className="block w-full">
                <img className="max-h-[780px] w-full rounded-lg object-contain shadow-sm 2xl:max-h-[940px]" src={imageURL} alt="Оригинальное задание" />
              </a>
            ) : (
              <div className="max-w-xs text-center text-sm leading-6 text-slate-500">Изображение не загружено или используется встроенный HTML-шаблон.</div>
            )}
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="section-title">Результаты обработки</div>
          <div className="space-y-4 p-4 sm:p-5">
            {steps.length > 0 ? (
              <PipelineResults
                steps={steps}
                currentStep={data?.current_step ?? 1}
                canEdit={data?.status === 'awaiting_confirmation' || data?.status === 'succeeded'}
                processing={updateStep.isPending || continueRun.isPending || regenerateStep.isPending}
                onSave={(step, content) => updateStep.mutateAsync({ step, content })}
                onSaveAndContinue={async (step, content) => {
                  await updateStep.mutateAsync({ step, content });
                  const nextStep = step + 1;
                  await continueRun.mutateAsync({
                    step_model: stepModels[nextStep] ?? 'pro',
                    ...(nextStep === 4 ? { final_model: stepModels[4] ?? 'pro', variant_count: variantCount } : {}),
                  });
                }}
                stepModels={stepModels}
                onStepModelChange={(step, model) => setStepModels((current) => ({ ...current, [step]: model }))}
                variantCount={variantCount}
                onVariantCountChange={setVariantCount}
                onRegenerate={(step) => regenerateStep.mutate(step)}
              />
            ) : null}
            {isRunning ? <RunningState step={data?.current_step ?? 1} /> : null}
            {data?.status === 'failed' ? (
              <FailedState
                message={data.error_message ?? 'Не удалось обработать задание.'}
                onRetry={() => restart.mutate()}
                retrying={restart.isPending}
              />
            ) : null}
            {canContinue ? (
              <ContinueState
                step={data.current_step}
                nextStepModel={stepModels[(data.current_step ?? 1) + 1] ?? 'pro'}
                onNextStepModelChange={(value) =>
                  setStepModels((current) => ({ ...current, [(data.current_step ?? 1) + 1]: value }))
                }
                onContinue={() =>
                  continueRun.mutate({
                    step_model: stepModels[(data.current_step ?? 1) + 1] ?? 'pro',
                    ...(data.current_step + 1 === 4 ? { final_model: stepModels[4] ?? 'pro', variant_count: variantCount } : {}),
                  })
                }
                processing={continueRun.isPending}
                hidden={data.current_step === 2 || data.current_step === 3}
              />
            ) : null}
            {data?.status === 'succeeded' ? (
              <>
                <CompletedState />
                <FinalDocumentCard
                  sourceHTML={sourceHTML}
                  variants={variantsHTML}
                  selectedVariant={selectedVariant}
                  onAcceptVariant={async (variant) => {
                    await updateStep.mutateAsync({ step: 4, content: variant });
                  }}
                  title={assignment.data?.title || 'Новое задание'}
                />
              </>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function PipelineResults({
  steps,
  currentStep,
  canEdit,
  processing,
  onSave,
  onSaveAndContinue,
  stepModels,
  onStepModelChange,
  variantCount,
  onVariantCountChange,
  onRegenerate,
}: {
  steps: PipelineStepResult[];
  currentStep: number;
  canEdit: boolean;
  processing: boolean;
  onSave: (step: number, content: string) => Promise<unknown>;
  onSaveAndContinue: (step: number, content: string) => Promise<unknown>;
  stepModels: Record<number, 'lite' | 'pro'>;
  onStepModelChange: (step: number, value: 'lite' | 'pro') => void;
  variantCount: number;
  onVariantCountChange: (value: number) => void;
  onRegenerate: (step: number) => void;
}) {
  return (
    <div className="space-y-3">
      {steps.map((step) => {
        const isEditableCheckpoint = canEdit && step.step === currentStep && (step.step === 2 || step.step === 3);
        return (
          <article key={`${step.step}-${step.key}`} className="overflow-hidden rounded-lg border border-slate-200/80 bg-white/95 shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-200/80 bg-[linear-gradient(90deg,#ffffff,rgba(231,229,255,0.58),rgba(223,247,255,0.5))] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[linear-gradient(135deg,#266f85,#5b7cfa)] text-xs font-semibold text-white">
                  {step.step}
                </span>
                <h2 className="text-sm font-semibold text-slate-900">{step.title}</h2>
              </div>
              {canEdit ? (
                <button className="btn-secondary px-3 py-1.5 text-xs" disabled={processing} onClick={() => onRegenerate(step.step)} type="button">
                  {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                  Перегенерировать
                </button>
              ) : null}
            </div>
            {isEditableCheckpoint && step.step === 2 ? (
              <ParameterEditor
                content={step.content}
                processing={processing}
                stepModel={stepModels[3] ?? 'pro'}
                onStepModelChange={(value) => onStepModelChange(3, value)}
                onSave={(content) => onSave(step.step, content)}
                onSaveAndContinue={(content) => onSaveAndContinue(step.step, content)}
              />
            ) : isEditableCheckpoint && step.step === 3 ? (
              <VariationEditor
                content={step.content}
                processing={processing}
                finalModel={stepModels[4] ?? 'pro'}
                onFinalModelChange={(value) => onStepModelChange(4, value)}
                variantCount={variantCount}
                onVariantCountChange={onVariantCountChange}
                onSave={(content) => onSave(step.step, content)}
                onSaveAndContinue={(content) => onSaveAndContinue(step.step, content)}
              />
            ) : (
              <StepContentView step={step} />
            )}
          </article>
        );
      })}
    </div>
  );
}

function StepContentView({ step }: { step: PipelineStepResult }) {
  const isHTMLStep = step.key === 'source_html' || step.key === 'variant_html';
  if (isHTMLStep) {
    return (
      <div className="max-h-[500px] overflow-auto bg-white px-5 py-4 text-sm">
        <HTMLDocument html={step.content} />
      </div>
    );
  }
  return (
    <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words bg-white p-4 text-sm leading-6 text-slate-800">
      {step.content}
    </pre>
  );
}

const subjectOptions = ['*', 'Русский язык', 'Математика', 'Обществознание', 'Информатика и ИКТ', 'География', 'Биология', 'Физика', 'Химия', 'История', 'Литература', 'Иностранные языки'];
const taskTypeOptions = ['*', 'Множественный выбор (Multiple choice)', 'Альтернативный выбор (True/False)', 'Перекрестный выбор (Matching)', 'Упорядочение (Rearrangement)', 'Заполнение пропусков (Completion)', 'Вставка слова в нужной форме / Трансформация (Transformation)', 'Ответ на вопрос (Answering questions)', 'Перевод (Translation)', 'Диалог / Интервью (Dialogue / Interview)', 'Обсуждение (Discussion)', 'Написание письма / эссе (Letter / Essay writing)', 'Имитация / Кроссворд / языковые игры (Crossword / Language games)'];
const classOptions = ['*', ...Array.from({ length: 11 }, (_, index) => String(index + 1))];
const difficultyOptions = ['*', ...Array.from({ length: 10 }, (_, index) => String(index + 1))];
const variationOptions = [
  'замена числовых данных (диапазон, тип чисел — целые, десятичные, дроби)',
  'изменение порядка перечисления (список условий, объектов, действий)',
  'синонимическая замена неключевых формулировок',
  'замена контекста (ситуации, примеры) при сохранении логики',
  'изменение имён, названий, единиц измерения (без изменения сложности)',
  'перестановка шагов в многошаговой инструкции',
];

function ParameterEditor({
  content,
  processing,
  stepModel,
  onStepModelChange,
  onSave,
  onSaveAndContinue,
}: {
  content: string;
  processing: boolean;
  stepModel: 'lite' | 'pro';
  onStepModelChange: (value: 'lite' | 'pro') => void;
  onSave: (content: string) => Promise<unknown>;
  onSaveAndContinue: (content: string) => Promise<unknown>;
}) {
  const initial = parseParameters(content);
  const [subject, setSubject] = useState(initial.subject);
  const [taskType, setTaskType] = useState(initial.taskType);
  const [schoolClass, setSchoolClass] = useState(initial.schoolClass);
  const [difficulty, setDifficulty] = useState(initial.difficulty);
  const value = formatParameters({ subject, taskType, schoolClass, difficulty });

  return (
    <div className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Предметная область" value={subject} options={subjectOptions} onChange={setSubject} />
        <SelectField label="Тип задания" value={taskType} options={taskTypeOptions} onChange={setTaskType} />
        <SelectField label="Предполагаемый класс" value={schoolClass} options={classOptions} onChange={setSchoolClass} />
        <SelectField label="Уровень сложности" value={difficulty} options={difficultyOptions} onChange={setDifficulty} />
      </div>
      <div className="space-y-1.5">
        <label className="label" htmlFor="step3-model">Модель для следующего шага (шаг 3)</label>
        <select id="step3-model" className="field" value={stepModel} onChange={(event) => onStepModelChange(event.target.value as 'lite' | 'pro')}>
          <option value="pro">Pro</option>
          <option value="lite">Lite</option>
        </select>
      </div>
      <EditorActions processing={processing} onSave={() => onSave(value)} onSaveAndContinue={() => onSaveAndContinue(value)} />
    </div>
  );
}

function VariationEditor({
  content,
  processing,
  finalModel,
  onFinalModelChange,
  variantCount,
  onVariantCountChange,
  onSave,
  onSaveAndContinue,
}: {
  content: string;
  processing: boolean;
  finalModel: 'lite' | 'pro';
  onFinalModelChange: (value: 'lite' | 'pro') => void;
  variantCount: number;
  onVariantCountChange: (value: number) => void;
  onSave: (content: string) => Promise<unknown>;
  onSaveAndContinue: (content: string) => Promise<unknown>;
}) {
  const initial = parseVariationContent(content);
  const [selected, setSelected] = useState<string[]>(initial.rules);
  const [custom, setCustom] = useState('');
  const [comment, setComment] = useState(initial.comment);
  const value = formatVariationContent(selected, comment);

  function toggle(rule: string) {
    setSelected((current) => current.includes(rule) ? current.filter((item) => item !== rule) : [...current, rule]);
  }

  function addCustom() {
    const next = custom.trim();
    if (!next || selected.includes(next)) {
      setCustom('');
      return;
    }
    setSelected((current) => [...current, next]);
    setCustom('');
  }

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-2">
        {variationOptions.map((rule) => (
          <label key={rule} className="flex items-start gap-2 rounded-md border border-slate-200 bg-[linear-gradient(135deg,rgba(255,255,255,0.88),rgba(247,245,255,0.76))] p-3 text-sm text-slate-800 transition hover:border-leaf/30 hover:brightness-105">
            <input className="mt-1" type="checkbox" checked={selected.includes(rule)} onChange={() => toggle(rule)} />
            <span>{rule}</span>
          </label>
        ))}
      </div>
      <div className="space-y-2">
        {selected.filter((rule) => !variationOptions.includes(rule)).map((rule) => (
          <div key={rule} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
            <span>{rule}</span>
            <button className="btn-secondary px-2 py-1" type="button" onClick={() => toggle(rule)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input className="field" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Добавить свое допустимое изменение" />
          <button className="btn-secondary" type="button" onClick={addCustom}>
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="label" htmlFor="variation-comment">Комментарий к генерации</label>
        <textarea id="variation-comment" className="field min-h-24" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Например: сохранить формат ответов, не менять количество пунктов" />
      </div>
      <div className="space-y-1.5">
        <label className="label" htmlFor="final-model">Модель для шага 4 (финальный вариант)</label>
        <select
          id="final-model"
          className="field"
          value={finalModel}
          onChange={(event) => onFinalModelChange(event.target.value as 'lite' | 'pro')}
        >
          <option value="pro">Pro</option>
          <option value="lite">Lite</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="label" htmlFor="variant-count">Количество новых вариантов (1-10)</label>
        <select
          id="variant-count"
          className="field"
          value={variantCount}
          onChange={(event) => onVariantCountChange(Number(event.target.value))}
        >
          {Array.from({ length: 10 }, (_, index) => index + 1).map((count) => (
            <option key={count} value={count}>{count}</option>
          ))}
        </select>
      </div>
      <EditorActions processing={processing} onSave={() => onSave(value)} onSaveAndContinue={() => onSaveAndContinue(value)} />
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1.5">
      <span className="label">{label}</span>
      <select className="field" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function EditorActions({ processing, onSave, onSaveAndContinue }: { processing: boolean; onSave: () => void; onSaveAndContinue: () => void }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <button className="btn-secondary" disabled={processing} onClick={onSave} type="button">
        {processing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="h-4 w-4" aria-hidden="true" />}
        Сохранить
      </button>
      <button className="btn-primary" disabled={processing} onClick={onSaveAndContinue} type="button">
        {processing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        Сохранить и продолжить
      </button>
    </div>
  );
}

function RunningState({ step }: { step: number }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-leaf/20 bg-[linear-gradient(135deg,#e7e5ff,#dff7ff)] text-center text-sm text-leaf">
      <Loader2 className="h-7 w-7 animate-spin text-leaf" aria-hidden="true" />
      Выполняется шаг {step} из {totalSteps}
    </div>
  );
}

function ContinueState({
  step,
  nextStepModel,
  onNextStepModelChange,
  onContinue,
  processing,
  hidden,
}: {
  step: number;
  nextStepModel: 'lite' | 'pro';
  onNextStepModelChange: (value: 'lite' | 'pro') => void;
  onContinue: () => void;
  processing: boolean;
  hidden?: boolean;
}) {
  if (hidden) {
    return null;
  }
  return (
    <div className="space-y-3 rounded-lg border border-honey/50 bg-[linear-gradient(135deg,#fff7ed,#fffbe8)] p-4 text-sm text-amber-950">
      <div className="font-medium">Шаг {step} завершен. Проверьте промежуточный результат перед продолжением.</div>
      <div className="space-y-1.5">
        <label className="label text-amber-900" htmlFor="continue-step-model">Модель для следующего шага</label>
        <select
          id="continue-step-model"
          className="field"
          value={nextStepModel}
          onChange={(event) => onNextStepModelChange(event.target.value as 'lite' | 'pro')}
        >
          <option value="pro">Pro</option>
          <option value="lite">Lite</option>
        </select>
      </div>
      <button className="btn-primary" disabled={processing} onClick={onContinue} type="button">
        {processing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        Продолжить обработку
      </button>
    </div>
  );
}

function CompletedState() {
  return (
    <div className="rounded-lg border border-leaf/20 bg-[linear-gradient(135deg,#e7e5ff,#dff7ff)] p-4 text-sm text-leaf">
      <div className="flex items-center gap-2 font-medium">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Обработка завершена
      </div>
    </div>
  );
}

function FinalDocumentCard({
  sourceHTML,
  variants,
  selectedVariant,
  onAcceptVariant,
  title,
}: {
  sourceHTML: string;
  variants: string[];
  selectedVariant: number;
  onAcceptVariant: (variant: string) => Promise<unknown>;
  title: string;
}) {
  const documentRef = useRef<HTMLDivElement>(null);
  const allVariantsDocumentRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedVariant - 1));
  const [accepting, setAccepting] = useState(false);

  const safeVariants = variants.filter((variant) => variant.trim().length > 0);
  const activeVariant = safeVariants[activeIndex] ?? '';

  async function downloadPDF() {
    if (!documentRef.current || !activeVariant.trim()) {
      return;
    }

    setGenerating(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const pdfOptions: Record<string, unknown> = {
        margin: [12, 12, 14, 12],
        filename: `${safeFilename(title)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      };

      await html2pdf()
        .set(pdfOptions)
        .from(documentRef.current)
        .save();
    } finally {
      setGenerating(false);
    }
  }

  async function downloadAllVariantsPDF() {
    if (!allVariantsDocumentRef.current || safeVariants.length === 0) {
      return;
    }

    setGeneratingAll(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const pdfOptions: Record<string, unknown> = {
        margin: [10, 10, 12, 10],
        filename: `${safeFilename(title)}-all-variants.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      };

      await html2pdf()
        .set(pdfOptions)
        .from(allVariantsDocumentRef.current)
        .save();
    } finally {
      setGeneratingAll(false);
    }
  }

  async function acceptVariant() {
    if (!activeVariant.trim()) {
      return;
    }
    setAccepting(true);
    try {
      await onAcceptVariant(activeVariant);
    } finally {
      setAccepting(false);
    }
  }

  if (!activeVariant.trim()) {
    return null;
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200/80 bg-white/75 p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-950">Сравнение вариантов</h2>
          <p className="mt-1 text-sm text-slate-600">Сравните эталон и новые варианты, затем выберите лучший.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" disabled={accepting} onClick={acceptVariant} type="button">
            {accepting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            Принять вариант
          </button>
          <button className="btn-secondary" disabled={generatingAll || safeVariants.length === 0} onClick={downloadAllVariantsPDF} type="button">
            {generatingAll ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            Скачать все варианты PDF
          </button>
          <button className="btn-primary" disabled={generating} onClick={downloadPDF} type="button">
            {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            Скачать PDF
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {safeVariants.map((_, index) => (
          <button
            key={`variant-tab-${index}`}
            className={`btn-secondary px-3 py-1.5 text-xs ${index === activeIndex ? 'border-leaf bg-[linear-gradient(135deg,#e7e5ff,#dff7ff)] text-leaf' : ''}`}
            type="button"
            onClick={() => setActiveIndex(index)}
          >
            Вариант {index + 1}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="section-title">Эталон (шаг 1)</div>
          <div className="max-h-[640px] overflow-auto px-5 py-4 text-sm">
            <HTMLDocument html={sourceHTML} />
          </div>
        </article>
        <article className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="section-title">Новый вариант {activeIndex + 1}</div>
          <div className="max-h-[640px] overflow-auto px-5 py-4 text-sm">
            <HTMLDocument html={activeVariant} />
          </div>
        </article>
      </div>

      <div className="hidden">
        <div ref={documentRef} className="bg-white px-10 py-9 text-slate-950">
          <div className="mb-7 border-b border-slate-200 pb-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-leaf">Вариант задания</div>
            <div className="mt-2 text-2xl font-semibold leading-tight text-slate-950">{title} · вариант {activeIndex + 1}</div>
          </div>
          <HTMLDocument html={activeVariant} />
        </div>
        <div ref={allVariantsDocumentRef} className="bg-white px-8 py-8 text-slate-950">
          {safeVariants.map((variant, index) => (
            <section key={`pdf-variant-${index}`} className={index > 0 ? 'mt-10 break-before-page border-t border-slate-200 pt-8' : ''}>
              <div className="mb-6 border-b border-slate-200 pb-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-leaf">Вариант задания</div>
                <div className="mt-2 text-2xl font-semibold leading-tight text-slate-950">{title} · вариант {index + 1}</div>
              </div>
              <HTMLDocument html={variant} />
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

function HTMLDocument({ html }: { html: string }) {
  return (
    <div className="document-html max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
  );
}

function FailedState({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="space-y-4 rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />
        <div>
          <div className="font-medium text-red-900">Не удалось обработать задание</div>
          <div className="mt-1 text-sm text-red-800">{message}</div>
        </div>
      </div>
      <button className="btn-secondary" disabled={retrying} onClick={onRetry} type="button">
        {retrying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
        Запустить заново
      </button>
    </div>
  );
}

function safeFilename(value: string) {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return normalized || 'assignment-variant';
}

function parseParameters(content: string) {
  const get = (label: string) => {
    const line = content.split(/\r?\n/).find((item) => item.toLowerCase().startsWith(label.toLowerCase()));
    return line?.slice(label.length).replace(/^:\s*/, '').trim() || '*';
  };
  return {
    subject: normalizeOption(get('Предметная область'), subjectOptions),
    taskType: normalizeOption(get('Тип задания'), taskTypeOptions),
    schoolClass: normalizeOption(get('Предполагаемый класс'), classOptions),
    difficulty: normalizeOption(get('Уровень сложности задания'), difficultyOptions),
  };
}

function normalizeOption(value: string, options: string[]) {
  if (options.includes(value)) {
    return value;
  }
  return '*';
}

function formatParameters(values: { subject: string; taskType: string; schoolClass: string; difficulty: string }) {
  return [
    `Предметная область: ${values.subject}`,
    `Тип задания: ${values.taskType}`,
    `Предполагаемый класс: ${values.schoolClass}`,
    `Уровень сложности задания: ${values.difficulty}`,
  ].join('\n');
}

function parseVariationContent(content: string) {
  const [rulesText, commentText = ''] = content.split(/\n+Комментарий пользователя:\s*/i);
  const rules = rulesText
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    rules: rules.length > 0 ? rules : variationOptions.slice(0, 1),
    comment: commentText.trim(),
  };
}

function formatVariationContent(rules: string[], comment: string) {
  const uniqueRules = Array.from(new Set(rules.map((rule) => rule.trim()).filter(Boolean)));
  const base = uniqueRules.length > 0 ? uniqueRules.join(', ') : '-';
  const cleanComment = comment.trim();
  return cleanComment ? `${base}\n\nКомментарий пользователя:\n${cleanComment}` : base;
}

function statusLabel(status: string) {
  switch (status) {
    case 'pending':
      return 'ожидает запуска';
    case 'running':
      return 'выполняется';
    case 'awaiting_confirmation':
      return 'ожидает подтверждения';
    case 'succeeded':
      return 'завершено';
    case 'failed':
      return 'ошибка';
    default:
      return 'загрузка';
  }
}
