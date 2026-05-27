import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, CheckCircle2, Download, FileText, Loader2, RotateCcw, Save } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ExtractionOptions, PipelineStepResult, userMessage } from '../lib/api';
import { renderMathMarkers } from '../lib/math';

const totalSteps = 4;

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const runId = searchParams.get('run');
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
    mutationFn: (options?: ExtractionOptions) =>
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
    mutationFn: ({ step, options }: { step: number; options?: ExtractionOptions }) =>
      api.regenerateExtractionStep(runId!, step, options),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['extraction-run', runId] });
    },
  });
  const regenerateVariant = useMutation({
    mutationFn: (variantIndex: number) => api.regenerateVariant(runId!, variantIndex),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['extraction-run', runId] });
    },
  });

  const data = run.data;
  const steps = data?.parsed_content?.steps ?? data?.step_results ?? [];
  const sourceHTML = data?.parsed_content?.source_html ?? steps.find((step) => step.key === 'source_html')?.content ?? '';
  const finalHTML = data?.parsed_content?.variant_html ?? steps.find((step) => step.key === 'variant_html')?.content ?? '';
  const variantsHTML = data?.parsed_content?.variants_html ?? (finalHTML ? [finalHTML] : []);
  const variantAnswers = data?.parsed_content?.answers_by_variant ?? [];
  const allAnswers = data?.parsed_content?.answers_all ?? '';
  const selectedVariant = data?.parsed_content?.selected_variant ?? 1;
  const isRunning = data?.status === 'pending' || data?.status === 'running' || run.isLoading;
  const canContinue = data?.status === 'awaiting_confirmation' && data.current_step < totalSteps;
  const stepOptions = (_step: number): ExtractionOptions => ({});
  const generationOptions = (): ExtractionOptions => {
    return {
      variant_count: variantCount,
    };
  };

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
              <h1 className="text-2xl font-bold tracking-tight text-ink">Обработка задания</h1>
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

      <section className="grid gap-6">
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
                    ...(nextStep === 3 ? generationOptions() : stepOptions(nextStep)),
                  });
                }}
                variantCount={variantCount}
                onVariantCountChange={setVariantCount}
                onRegenerate={(step) => regenerateStep.mutate({ step, options: step === 3 ? generationOptions() : stepOptions(step) })}
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
                onContinue={() =>
                  continueRun.mutate({
                    ...(data.current_step + 1 === 3 ? generationOptions() : stepOptions((data.current_step ?? 1) + 1)),
                  })
                }
                processing={continueRun.isPending}
                hidden={data.current_step === 2}
              />
            ) : null}
            {data?.status === 'succeeded' ? (
              <>
                <CompletedState />
                <FinalDocumentCard
                  sourceHTML={sourceHTML}
                  variants={variantsHTML}
                  answersByVariant={variantAnswers}
                  answersAll={allAnswers}
                  selectedVariant={selectedVariant}
                  processing={isRunning || regenerateVariant.isPending}
                  onRegenerateVariant={(index) => regenerateVariant.mutate(index)}
                  onAcceptVariant={async (variant) => {
                    await updateStep.mutateAsync({ step: 3, content: variant });
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
  variantCount: number;
  onVariantCountChange: (value: number) => void;
  onRegenerate: (step: number) => void;
}) {
  return (
    <div className="space-y-3">
      {steps.map((step) => {
        const isEditableCheckpoint = canEdit && step.step === currentStep && step.step === 2;
        return (
          <article key={`${step.step}-${step.key}`} className="overflow-hidden rounded-lg border border-slate-200/80 bg-white/95 shadow-sm">
            <div className="flex flex-col gap-2 border-b border-slate-200/80 bg-[linear-gradient(90deg,#ffffff,rgba(231,229,255,0.58),rgba(223,247,255,0.5))] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[linear-gradient(135deg,#266f85,#5b7cfa)] text-xs font-semibold text-white">
                  {step.step}
                </span>
                <h2 className="text-sm font-semibold text-slate-900">{step.title}</h2>
              </div>
              {canEdit && step.step !== 4 ? (
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
  if (step.key === 'self_score') {
    return (
      <div className="bg-white px-5 py-4">
        <div className="inline-flex items-baseline gap-2 rounded-lg bg-[linear-gradient(135deg,#e7e5ff,#dff7ff)] px-4 py-3 text-leaf">
          <span className="text-3xl font-bold leading-none">{step.content}</span>
          <span className="text-sm font-semibold">/ 10</span>
        </div>
      </div>
    );
  }
  if (step.key === 'parameters') {
    return <TaskParametersView content={step.content} />;
  }
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

const taskTypeOptions = ['*', 'Тест с выбором ответа', 'Краткий ответ', 'Развернутый ответ', 'Решение задачи', 'Доказательство', 'Сопоставление', 'Установление последовательности', 'Заполнение пропусков', 'Работа с текстом', 'Работа с таблицей', 'Работа с графиком или диаграммой', 'Практическая работа', 'Лабораторная работа', 'Творческое задание', 'Эссе / сочинение', 'Перевод', 'Диалог / интервью', 'Кроссворд / игровые задания', 'Другое'];
const subjectOptions = ['*', 'Английский язык', 'Русский язык', 'Литература', 'Математика', 'Алгебра', 'Геометрия', 'Информатика', 'Физика', 'Химия', 'Биология', 'История', 'Обществознание', 'География', 'Иностранный язык', 'Другое'];
const classOptions = ['*', ...Array.from({ length: 11 }, (_, index) => String(index + 1))];
const difficultyOptions = ['*', ...Array.from({ length: 10 }, (_, index) => String(index + 1))];

type TaskParametersItem = {
  task_number: number;
  heading: string;
  task_type: string;
  subject: string;
  school_class: string;
  difficulty: string;
};

type ParameterBundle = {
  tasks: TaskParametersItem[];
  subject?: string;
  user_comment?: string;
};

function TaskParametersView({ content }: { content: string }) {
  const bundle = parseParameters(content);
  if (bundle.tasks.length === 0) {
    return (
      <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words bg-white p-4 text-sm leading-6 text-slate-800">
        {content}
      </pre>
    );
  }
  return (
    <div className="space-y-3 bg-white p-4">
      {bundle.tasks.map((task) => (
        <div key={task.task_number} className="rounded-lg border border-slate-200/80 bg-[linear-gradient(135deg,#ffffff,#f8fbff)] p-4">
          <div className="text-sm font-semibold text-slate-900">{task.heading || `Задание ${task.task_number}`}</div>
          <div className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-4">
            <div><span className="font-medium text-slate-900">Тип:</span> {task.task_type}</div>
            <div><span className="font-medium text-slate-900">Предмет:</span> {task.subject}</div>
            <div><span className="font-medium text-slate-900">Класс:</span> {task.school_class}</div>
            <div><span className="font-medium text-slate-900">Сложность:</span> {task.difficulty}</div>
          </div>
        </div>
      ))}
      {bundle.user_comment?.trim() ? (
        <div className="rounded-lg border border-slate-200/80 bg-slate-50 p-4 text-sm text-slate-700">
          <div className="font-medium text-slate-900">Комментарий к генерации</div>
          <div className="mt-2 whitespace-pre-wrap">{bundle.user_comment.trim()}</div>
        </div>
      ) : null}
    </div>
  );
}

function ParameterEditor({
  content,
  processing,
  variantCount,
  onVariantCountChange,
  onSave,
  onSaveAndContinue,
}: {
  content: string;
  processing: boolean;
  variantCount: number;
  onVariantCountChange: (value: number) => void;
  onSave: (content: string) => Promise<unknown>;
  onSaveAndContinue: (content: string) => Promise<unknown>;
}) {
  const initial = parseParameters(content);
  const [tasks, setTasks] = useState(initial.tasks);
  const [subject, setSubject] = useState(initial.subject ?? '*');
  const [comment, setComment] = useState(initial.user_comment ?? '');
  const value = formatParameters({
    tasks: tasks.map((task) => ({ ...task, subject })),
    subject,
    user_comment: comment,
  });

  function updateTask(index: number, field: keyof TaskParametersItem, value: string) {
    setTasks((current) => current.map((task, taskIndex) => (
      taskIndex === index ? { ...task, [field]: value } : task
    )));
  }

  return (
    <div className="space-y-4 p-4">
      <div className="space-y-4">
        <SelectField label="Предмет" value={normalizeOption(subject, subjectOptions)} options={subjectOptions} onChange={(value) => setSubject(value)} />
        {tasks.map((task, index) => (
          <div key={task.task_number} className="rounded-lg border border-slate-200/80 bg-[linear-gradient(135deg,#ffffff,#f8fbff)] p-4">
            <div className="mb-3 text-sm font-semibold text-slate-900">{task.heading || `Задание ${task.task_number}`}</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField label="Тип задания" value={normalizeTaskType(task.task_type)} options={taskTypeOptions} onChange={(value) => updateTask(index, 'task_type', value)} />
              <SelectField label="Предполагаемый класс" value={normalizeOption(task.school_class, classOptions)} options={classOptions} onChange={(value) => updateTask(index, 'school_class', value)} />
              <SelectField label="Уровень сложности" value={normalizeOption(task.difficulty, difficultyOptions)} options={difficultyOptions} onChange={(value) => updateTask(index, 'difficulty', value)} />
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <label className="label" htmlFor="generation-comment">Комментарий к генерации</label>
        <textarea
          id="generation-comment"
          className="field min-h-24"
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Например: сохранить количество пунктов и формат вариантов ответов"
        />
      </div>
      <div className="max-w-48 space-y-1.5">
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
  onContinue,
  processing,
  hidden,
}: {
  step: number;
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
  answersByVariant,
  answersAll,
  selectedVariant,
  processing,
  onRegenerateVariant,
  onAcceptVariant,
  title,
}: {
  sourceHTML: string;
  variants: string[];
  answersByVariant: string[];
  answersAll: string;
  selectedVariant: number;
  processing: boolean;
  onRegenerateVariant: (variantIndex: number) => void;
  onAcceptVariant: (variant: string) => Promise<unknown>;
  title: string;
}) {
  const documentRef = useRef<HTMLDivElement>(null);
  const allVariantsDocumentRef = useRef<HTMLDivElement>(null);
  const answerDocumentRef = useRef<HTMLDivElement>(null);
  const allAnswersDocumentRef = useRef<HTMLDivElement>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingAll, setGeneratingAll] = useState(false);
  const [generatingAnswers, setGeneratingAnswers] = useState(false);
  const [generatingAllAnswers, setGeneratingAllAnswers] = useState(false);
  const [activeIndex, setActiveIndex] = useState(Math.max(0, selectedVariant - 1));
  const [accepting, setAccepting] = useState(false);

  const safeVariants = variants.filter((variant) => variant.trim().length > 0);
  const activeVariant = safeVariants[activeIndex] ?? '';
  const activeAnswers = answersByVariant[activeIndex] ?? '';

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

  async function downloadAnswersPDF() {
    if (!answerDocumentRef.current || !activeAnswers.trim()) {
      return;
    }
    setGeneratingAnswers(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const pdfOptions: Record<string, unknown> = {
        margin: [12, 12, 14, 12],
        filename: `${safeFilename(title)}-variant-${activeIndex + 1}-answers.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      };
      await html2pdf().set(pdfOptions).from(answerDocumentRef.current).save();
    } finally {
      setGeneratingAnswers(false);
    }
  }

  async function downloadAllAnswersPDF() {
    if (!allAnswersDocumentRef.current || !answersAll.trim()) {
      return;
    }
    setGeneratingAllAnswers(true);
    try {
      const html2pdf = (await import('html2pdf.js')).default;
      const pdfOptions: Record<string, unknown> = {
        margin: [10, 10, 12, 10],
        filename: `${safeFilename(title)}-all-answers.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      };
      await html2pdf().set(pdfOptions).from(allAnswersDocumentRef.current).save();
    } finally {
      setGeneratingAllAnswers(false);
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
          <button className="btn-secondary" disabled={generatingAnswers || !activeAnswers.trim()} onClick={downloadAnswersPDF} type="button">
            {generatingAnswers ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            Скачать ответы для варианта
          </button>
          <button className="btn-secondary" disabled={generatingAllAnswers || !answersAll.trim()} onClick={downloadAllAnswersPDF} type="button">
            {generatingAllAnswers ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
            Скачать ответы на все варианты
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
          <div className="section-title flex items-center justify-between gap-3">
            <span>Новый вариант {activeIndex + 1}</span>
            <button className="btn-secondary h-8 px-2 text-xs" disabled={processing} type="button" onClick={() => onRegenerateVariant(activeIndex + 1)}>
              {processing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
              Перегенерировать
            </button>
          </div>
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
        <div ref={answerDocumentRef} className="bg-white px-10 py-9 text-slate-950">
          <div className="mb-7 border-b border-slate-200 pb-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-leaf">Ответы</div>
            <div className="mt-2 text-2xl font-semibold leading-tight text-slate-950">{title} · вариант {activeIndex + 1}</div>
          </div>
          <HTMLDocument html={activeAnswers} />
        </div>
        <div ref={allAnswersDocumentRef} className="bg-white px-8 py-8 text-slate-950">
          <HTMLDocument html={answersAll} />
        </div>
      </div>
    </section>
  );
}

function HTMLDocument({ html }: { html: string }) {
  const rendered = stripVisibleParagraphTags(renderMathMarkers(jsonPipelineDocumentToHTML(html) ?? html));
  return (
    <div className="document-html max-w-none" dangerouslySetInnerHTML={{ __html: rendered }} />
  );
}

function jsonPipelineDocumentToHTML(value: string) {
  try {
    const parsed = JSON.parse(value) as { tasks?: Array<{ title?: string; text?: string }> } | Array<{ title?: string; text?: string }>;
    const tasks = Array.isArray(parsed) ? parsed : parsed.tasks;
    if (!Array.isArray(tasks)) {
      return null;
    }
    return tasks.map((task, index) => {
      const title = cleanPlainText(task.title || '') || `Задание ${index + 1}`;
      const text = stripTaskHeadings(task.text?.trim() || '');
      return `<section><h2>${escapeHTML(title)}</h2>${text}</section>`;
    }).join('');
  } catch {
    return null;
  }
}

function stripTaskHeadings(value: string) {
  return value
    .replace(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi, '')
    .replace(/&lt;h2\b[^&]*&gt;[\s\S]*?&lt;\/h2&gt;/gi, '')
    .trim();
}

function stripVisibleParagraphTags(value: string) {
  return value
    .replace(/&lt;\/?p&gt;/gi, '')
    .replace(/&amp;lt;\/?p&amp;gt;/gi, '')
    .replace(/<\/p>\s*<\/p>/gi, '</p>');
}

function cleanPlainText(value: string) {
  const element = document.createElement('div');
  element.innerHTML = value;
  return (element.textContent || element.innerText || value)
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHTML(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  try {
    const parsed = JSON.parse(content) as ParameterBundle;
    return {
      tasks: Array.isArray(parsed.tasks) && parsed.tasks.length > 0
        ? parsed.tasks.map((task, index) => ({
            task_number: task.task_number ?? index + 1,
            heading: cleanPlainText(task.heading ?? `Задание ${index + 1}`),
            task_type: normalizeTaskType(task.task_type ?? '*'),
            subject: normalizeSubject(task.subject ?? parsed.subject ?? '*'),
            school_class: normalizeOption(task.school_class ?? '*', classOptions),
            difficulty: normalizeOption(task.difficulty ?? '*', difficultyOptions),
          }))
        : [],
      subject: normalizeSubject(parsed.subject ?? parsed.tasks?.[0]?.subject ?? '*'),
      user_comment: parsed.user_comment ?? '',
    };
  } catch {
    return {
      tasks: [],
      subject: '*',
      user_comment: '',
    };
  }
}

function normalizeOption(value: string, options: string[]) {
  if (options.includes(value)) {
    return value;
  }
  return '*';
}

function normalizeTaskType(value: string) {
  const normalized = cleanPlainText(value);
  if (taskTypeOptions.includes(normalized)) {
    return normalized;
  }
  const lower = normalized.toLowerCase();
  if (lower.includes('multiple choice') || lower.includes('множественный выбор') || lower.includes('альтернативный выбор') || lower.includes('true/false')) {
    return 'Тест с выбором ответа';
  }
  if (lower.includes('matching') || lower.includes('перекрестный выбор') || lower.includes('сопостав')) {
    return 'Сопоставление';
  }
  if (lower.includes('rearrangement') || lower.includes('упорядоч')) {
    return 'Установление последовательности';
  }
  if (lower.includes('completion') || lower.includes('заполнение пропуск') || lower.includes('transformation') || lower.includes('трансформац')) {
    return 'Заполнение пропусков';
  }
  if (lower.includes('answering questions') || lower.includes('ответ на вопрос')) {
    return 'Краткий ответ';
  }
  if (lower.includes('translation') || lower.includes('перевод')) {
    return 'Перевод';
  }
  if (lower.includes('dialogue') || lower.includes('interview') || lower.includes('диалог') || lower.includes('интервью')) {
    return 'Диалог / интервью';
  }
  if (lower.includes('discussion')) {
    return 'Развернутый ответ';
  }
  if (lower.includes('letter') || lower.includes('essay') || lower.includes('пись') || lower.includes('эссе') || lower.includes('сочинен')) {
    return 'Эссе / сочинение';
  }
  return '*';
}

function normalizeSubject(value: string) {
  return normalizeOption(value, subjectOptions);
}

function formatParameters(values: ParameterBundle) {
  return JSON.stringify(values, null, 2);
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
