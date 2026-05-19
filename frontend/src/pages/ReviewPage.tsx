import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowRight, CheckCircle2, Download, Loader2, RotateCcw } from 'lucide-react';
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
    mutationFn: () => api.continueExtractionRun(runId!),
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

  if (!id || !runId) {
    return (
      <div className="panel p-5 text-sm text-red-700">
        Не хватает параметров задания или запуска обработки.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Пайплайн обработки задания</h1>
          <p className="mt-1 text-sm text-slate-600">
            {assignment.data?.title || 'Эталонное задание'} · шаг {data?.current_step ?? 1} из {totalSteps} · статус:{' '}
            {statusLabel(data?.status ?? 'loading')}
          </p>
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

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(420px,1fr)]">
        <div className="panel overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-800">
            Оригинальное изображение
          </div>
          <div className="flex min-h-[520px] items-center justify-center bg-slate-100 p-4">
            {imageURL ? (
              <a href={imageURL} target="_blank" rel="noreferrer" className="block w-full">
                <img className="max-h-[720px] w-full rounded-md object-contain" src={imageURL} alt="Оригинальное задание" />
              </a>
            ) : (
              <div className="text-sm text-slate-500">Загружаем изображение...</div>
            )}
          </div>
        </div>

        <div className="panel overflow-hidden">
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-800">
            Результаты обработки
          </div>
          <div className="space-y-4 p-4">
            {steps.length > 0 ? <PipelineResults steps={steps} /> : null}
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
                onContinue={() => continueRun.mutate()}
                processing={continueRun.isPending}
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

function PipelineResults({ steps }: { steps: PipelineStepResult[] }) {
  return (
    <div className="space-y-3">
      {steps.map((step) => (
        <article key={`${step.step}-${step.key}`} className="rounded-lg border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-900 text-xs font-semibold text-white">
              {step.step}
            </span>
            <h2 className="text-sm font-semibold text-slate-900">{step.title}</h2>
          </div>
          <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap break-words p-3 text-sm leading-6 text-slate-800">
            {step.content}
          </pre>
        </article>
      ))}
    </div>
  );
}

function RunningState({ step }: { step: number }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-cyan-200 bg-cyan-50 text-center text-sm text-cyan-900">
      <Loader2 className="h-7 w-7 animate-spin text-cyan-700" aria-hidden="true" />
      Выполняется шаг {step} из {totalSteps}
    </div>
  );
}

function ContinueState({ step, onContinue, processing }: { step: number; onContinue: () => void; processing: boolean }) {
  return (
    <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
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
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
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
    <section className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Итоговое задание</h2>
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
            <div className="text-xs font-semibold uppercase tracking-wider text-cyan-700">Вариант задания</div>
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
