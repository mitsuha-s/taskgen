import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FileText,
  ListChecks,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  ScanText,
  Trash2,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, PipelineStepResult, userMessage } from '../lib/api';

const totalSteps = 4;
const pipelineStepNames = ['Сканирование', 'Параметры', 'Вариации', 'Финал'];

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runId = searchParams.get('run');
  const [finalModel, setFinalModel] = useState<'lite' | 'pro'>('pro');

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
    mutationFn: (model?: 'lite' | 'pro') => api.continueExtractionRun(runId!, model),
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
  const finalMarkdown = data?.parsed_content?.variant_markdown ?? steps.find((step) => step.key === 'variant_markdown')?.content ?? '';
  const isRunning = data?.status === 'pending' || data?.status === 'running' || run.isLoading;
  const canContinue = data?.status === 'awaiting_confirmation' && data.current_step < totalSteps;
  const imageURL = assignment.data?.image?.url;
  const runProvider = data?.provider ?? '';
  const isGigaChatRun = runProvider === 'gigachat';

  if (!id || !runId) {
    return (
      <div className="panel p-5 text-sm text-red-700">
        Не хватает параметров задания или запуска обработки.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="surface-dark machine-grid overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <span className="status-chip border-cyan-300/30 bg-white/[0.08] text-cyan-100">
              <BrainCircuit className="h-3.5 w-3.5" aria-hidden="true" />
              AI-контроль
            </span>
            <h1 className="mt-4 text-2xl font-semibold leading-tight text-white sm:text-3xl">Пайплайн обработки задания</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {assignment.data?.title || 'Эталонное задание'} · шаг {data?.current_step ?? 1} из {totalSteps} · провайдер:{' '}
              {providerLabel(runProvider)}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-end">
            <span className={statusBadgeClass(data?.status ?? 'loading')}>{statusLabel(data?.status ?? 'loading')}</span>
            <Link className="btn-secondary border-slate-600 bg-white/10 text-white hover:border-cyan-300/50 hover:bg-white/15" to="/assignments/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Новое задание
            </Link>
          </div>
        </div>
        <PipelineProgress currentStep={data?.current_step ?? 1} status={data?.status ?? 'loading'} />
      </section>

      {(assignment.isError || run.isError) && (
        <div className="panel border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {userMessage(assignment.error ?? run.error)}
        </div>
      )}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.05fr)]">
        <div className="panel overflow-hidden">
          <div className="panel-heading flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <ScanText className="h-4 w-4 text-ai" aria-hidden="true" />
              Оригинальное изображение
            </span>
            <span className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-500">
              Эталон
            </span>
          </div>
          <div className="scan-frame flex min-h-[520px] items-center justify-center rounded-none border-0 bg-slate-100 p-4">
            {imageURL ? (
              <a href={imageURL} target="_blank" rel="noreferrer" className="relative z-10 block w-full">
                <img className="max-h-[720px] w-full rounded-md border border-slate-200 bg-white object-contain shadow-sm" src={imageURL} alt="Оригинальное задание" />
              </a>
            ) : (
              <div className="relative z-10 rounded-md border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-500 shadow-sm">Загружаем изображение...</div>
            )}
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="panel-heading flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              <ListChecks className="h-4 w-4 text-ai" aria-hidden="true" />
              Результаты обработки
            </span>
            <span className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-500">
              Запуск
            </span>
          </div>
          <div className="space-y-4 bg-slate-50/60 p-4">
            {steps.length > 0 ? (
              <PipelineResults
                steps={steps}
                currentStep={data?.current_step ?? 1}
                canEdit={data?.status === 'awaiting_confirmation' || data?.status === 'succeeded'}
                processing={updateStep.isPending || continueRun.isPending || regenerateStep.isPending}
                onSave={(step, content) => updateStep.mutateAsync({ step, content })}
                onSaveAndContinue={async (step, content) => {
                  await updateStep.mutateAsync({ step, content });
                  await continueRun.mutateAsync(step === 3 && isGigaChatRun ? finalModel : undefined);
                }}
                finalModel={finalModel}
                showFinalModel={isGigaChatRun}
                onFinalModelChange={setFinalModel}
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
                onContinue={() => continueRun.mutate(undefined)}
                processing={continueRun.isPending}
                hidden={data.current_step === 2 || data.current_step === 3}
              />
            ) : null}
            {data?.status === 'succeeded' ? (
              <>
                <CompletedState />
                <FinalDocumentCard
                  markdown={finalMarkdown}
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

function PipelineProgress({ currentStep, status }: { currentStep: number; status: string }) {
  return (
    <div className="mt-6 grid gap-2 sm:grid-cols-4">
      {pipelineStepNames.map((name, index) => {
        const step = index + 1;
        const isDone = status === 'succeeded' || step < currentStep;
        const isActive = step === currentStep && status !== 'succeeded';
        return (
          <div
            key={name}
            className={`rounded-md border p-3 ${
              isActive
                ? 'border-cyan-300/50 bg-cyan-300/10'
                : isDone
                  ? 'border-emerald-300/30 bg-emerald-300/10'
                  : 'border-white/10 bg-white/[0.06]'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase text-slate-400">Шаг {step}</span>
              {isDone ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-300" aria-hidden="true" />
              ) : isActive ? (
                <Loader2 className="h-4 w-4 animate-spin text-cyan-200" aria-hidden="true" />
              ) : (
                <ClipboardCheck className="h-4 w-4 text-slate-500" aria-hidden="true" />
              )}
            </div>
            <div className="mt-2 text-sm font-semibold text-white">{name}</div>
          </div>
        );
      })}
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
  finalModel,
  showFinalModel,
  onFinalModelChange,
  onRegenerate,
}: {
  steps: PipelineStepResult[];
  currentStep: number;
  canEdit: boolean;
  processing: boolean;
  onSave: (step: number, content: string) => Promise<unknown>;
  onSaveAndContinue: (step: number, content: string) => Promise<unknown>;
  finalModel: 'lite' | 'pro';
  showFinalModel: boolean;
  onFinalModelChange: (value: 'lite' | 'pro') => void;
  onRegenerate: (step: number) => void;
}) {
  return (
    <div className="space-y-3">
      {steps.map((step) => {
        const isEditableCheckpoint = canEdit && step.step === currentStep && (step.step === 2 || step.step === 3);
        const isCurrent = step.step === currentStep;
        const stepState = step.step < currentStep ? 'Готово' : isCurrent ? 'Активный шаг' : 'Ожидает';
        return (
          <article
            key={`${step.step}-${step.key}`}
            className={`overflow-hidden rounded-lg border bg-white shadow-sm ${
              isCurrent ? 'border-cyan-300 shadow-cyan-900/5' : 'border-slate-200'
            }`}
          >
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-semibold ${
                    isCurrent ? 'bg-ai text-white' : 'bg-slate-900 text-white'
                  }`}
                >
                  {step.step}
                </span>
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">{step.title}</h2>
                  <div className="mt-0.5 text-xs font-medium text-slate-500">{stepState}</div>
                </div>
              </div>
              {canEdit ? (
                <button className="btn-secondary h-8 px-3 text-xs" disabled={processing} onClick={() => onRegenerate(step.step)} type="button">
                  {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                  Перегенерировать
                </button>
              ) : null}
            </div>
            {isEditableCheckpoint && step.step === 2 ? (
              <ParameterEditor
                content={step.content}
                processing={processing}
                onSave={(content) => onSave(step.step, content)}
                onSaveAndContinue={(content) => onSaveAndContinue(step.step, content)}
              />
            ) : isEditableCheckpoint && step.step === 3 ? (
              <VariationEditor
                content={step.content}
                processing={processing}
                finalModel={finalModel}
                showFinalModel={showFinalModel}
                onFinalModelChange={onFinalModelChange}
                onSave={(content) => onSave(step.step, content)}
                onSaveAndContinue={(content) => onSaveAndContinue(step.step, content)}
              />
            ) : (
              <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words bg-slate-50 p-4 text-sm leading-6 text-slate-800">
                {step.content}
              </pre>
            )}
          </article>
        );
      })}
    </div>
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
  onSave,
  onSaveAndContinue,
}: {
  content: string;
  processing: boolean;
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
    <div className="space-y-4 bg-cyan-50/30 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Предметная область" value={subject} options={subjectOptions} onChange={setSubject} />
        <SelectField label="Тип задания" value={taskType} options={taskTypeOptions} onChange={setTaskType} />
        <SelectField label="Предполагаемый класс" value={schoolClass} options={classOptions} onChange={setSchoolClass} />
        <SelectField label="Уровень сложности" value={difficulty} options={difficultyOptions} onChange={setDifficulty} />
      </div>
      <EditorActions processing={processing} onSave={() => onSave(value)} onSaveAndContinue={() => onSaveAndContinue(value)} />
    </div>
  );
}

function VariationEditor({
  content,
  processing,
  finalModel,
  showFinalModel,
  onFinalModelChange,
  onSave,
  onSaveAndContinue,
}: {
  content: string;
  processing: boolean;
  finalModel: 'lite' | 'pro';
  showFinalModel: boolean;
  onFinalModelChange: (value: 'lite' | 'pro') => void;
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
    <div className="space-y-4 bg-cyan-50/30 p-4">
      <div className="grid gap-2">
        {variationOptions.map((rule) => (
          <label key={rule} className="flex items-start gap-3 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-800 shadow-sm transition hover:border-cyan-300">
            <input className="mt-1 accent-ai" type="checkbox" checked={selected.includes(rule)} onChange={() => toggle(rule)} />
            <span>{rule}</span>
          </label>
        ))}
      </div>
      <div className="space-y-2">
        {selected.filter((rule) => !variationOptions.includes(rule)).map((rule) => (
          <div key={rule} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm">
            <span>{rule}</span>
            <button className="btn-secondary h-8 px-2" type="button" onClick={() => toggle(rule)}>
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input className="field" value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Добавить свое допустимое изменение" />
          <button className="btn-secondary w-11 px-0" type="button" onClick={addCustom}>
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="label" htmlFor="variation-comment">Комментарий к генерации</label>
        <textarea id="variation-comment" className="field min-h-24" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Например: сохранить формат ответов, не менять количество пунктов" />
      </div>
      {showFinalModel ? (
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
      ) : null}
      <EditorActions processing={processing} onSave={() => onSave(value)} onSaveAndContinue={() => onSaveAndContinue(value)} />
    </div>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="space-y-1.5">
      <span className="label">{label}</span>
      <select className="field bg-white" value={value} onChange={(event) => onChange(event.target.value)}>
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
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-cyan-200 bg-cyan-50/80 text-center text-sm text-cyan-950 shadow-sm">
      <span className="flex h-12 w-12 items-center justify-center rounded-md border border-cyan-200 bg-white shadow-sm">
        <Loader2 className="h-7 w-7 animate-spin text-ai" aria-hidden="true" />
      </span>
      <span className="font-semibold">Выполняется шаг {step} из {totalSteps}</span>
    </div>
  );
}

function ContinueState({ step, onContinue, processing, hidden }: { step: number; onContinue: () => void; processing: boolean; hidden?: boolean }) {
  if (hidden) {
    return null;
  }
  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 shadow-sm">
      <div className="font-medium">Шаг {step} завершен. Проверьте промежуточный результат перед продолжением.</div>
      <button className="btn-primary" disabled={processing} onClick={onContinue} type="button">
        {processing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        Продолжить обработку
      </button>
    </div>
  );
}

function CompletedState() {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900 shadow-sm">
      <div className="flex items-center gap-2 font-medium">
        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
        Обработка завершена
      </div>
    </div>
  );
}

function FinalDocumentCard({ markdown, title }: { markdown: string; title: string }) {
  const documentRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);

  async function downloadPDF() {
    if (!documentRef.current || !markdown.trim()) {
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

  if (!markdown.trim()) {
    return null;
  }

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <FileText className="h-4 w-4 text-ai" aria-hidden="true" />
            Итоговое задание
          </h2>
          <p className="mt-1 text-sm text-slate-600">Готовый вариант можно скачать в PDF.</p>
        </div>
        <button className="btn-primary" disabled={generating} onClick={downloadPDF} type="button">
          {generating ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          Скачать PDF
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div ref={documentRef} className="bg-white px-10 py-9 text-slate-950">
          <div className="mb-7 border-b border-slate-200 pb-4">
            <div className="text-xs font-semibold uppercase text-ai">Вариант задания</div>
            <div className="mt-2 text-2xl font-semibold leading-tight text-slate-950">{title}</div>
          </div>
          <MarkdownDocument markdown={markdown} />
        </div>
      </div>
    </section>
  );
}

function MarkdownDocument({ markdown }: { markdown: string }) {
  const blocks = parseMarkdown(markdown);

  return (
    <div className="space-y-4 text-[15px] leading-7 text-slate-900">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          const Tag = block.level === 1 ? 'h1' : block.level === 2 ? 'h2' : 'h3';
          const className =
            block.level === 1
              ? 'text-2xl font-semibold leading-tight text-slate-950'
              : block.level === 2
                ? 'pt-2 text-xl font-semibold leading-snug text-slate-950'
                : 'pt-1 text-base font-semibold text-slate-950';
          return (
            <Tag key={`${block.type}-${index}`} className={className}>
              {block.text}
            </Tag>
          );
        }

        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul';
          return (
            <ListTag
              key={`${block.type}-${index}`}
              className={block.ordered ? 'list-decimal space-y-1 pl-6' : 'list-disc space-y-1 pl-6'}
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`} className="pl-1">
                  {item}
                </li>
              ))}
            </ListTag>
          );
        }

        return (
          <p key={`${block.type}-${index}`} className="whitespace-pre-wrap">
            {block.text}
          </p>
        );
      })}
    </div>
  );
}

function FailedState({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="space-y-4 rounded-lg border border-red-200 bg-red-50 p-4 shadow-sm">
      <div className="flex gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-red-200 bg-white">
          <AlertCircle className="h-5 w-5 text-red-700" aria-hidden="true" />
        </span>
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

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] };

function parseMarkdown(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let listOrdered = false;

  function flushParagraph() {
    const text = paragraph.join('\n').trim();
    if (text) {
      blocks.push({ type: 'paragraph', text });
    }
    paragraph = [];
  }

  function flushList() {
    if (listItems.length > 0) {
      blocks.push({ type: 'list', ordered: listOrdered, items: listItems });
    }
    listItems = [];
    listOrdered = false;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      continue;
    }

    const unordered = /^[-*]\s+(.+)$/.exec(trimmed);
    const ordered = /^\d+[.)]\s+(.+)$/.exec(trimmed);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (listItems.length > 0 && listOrdered !== isOrdered) {
        flushList();
      }
      listOrdered = isOrdered;
      listItems.push((unordered?.[1] ?? ordered?.[1] ?? '').trim());
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
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

function providerLabel(provider: string) {
  switch (provider) {
    case 'gigachat':
      return 'GigaChat';
    case 'openai':
      return 'OpenAI';
    case 'mock':
      return 'Mock';
    default:
      return 'не выбран';
  }
}

function statusBadgeClass(status: string) {
  const base = 'inline-flex h-9 items-center justify-center rounded-md border px-3 text-xs font-semibold uppercase';
  switch (status) {
    case 'pending':
    case 'running':
    case 'loading':
      return `${base} border-cyan-300/[0.35] bg-cyan-300/10 text-cyan-100`;
    case 'awaiting_confirmation':
      return `${base} border-amber-300/40 bg-amber-300/10 text-amber-100`;
    case 'succeeded':
      return `${base} border-emerald-300/40 bg-emerald-300/10 text-emerald-100`;
    case 'failed':
      return `${base} border-red-300/40 bg-red-300/10 text-red-100`;
    default:
      return `${base} border-slate-500 bg-white/[0.08] text-slate-200`;
  }
}
