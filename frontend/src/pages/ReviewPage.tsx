import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ParsedAssignment, ParsedSection, userMessage } from '../lib/api';

export default function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
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

  const parsed = run.data?.parsed_content ?? null;
  const isRunning = run.data?.status === 'pending' || run.data?.status === 'running' || run.isLoading;
  const imageURL = assignment.data?.image?.url;

  if (!id || !runId) {
    return (
      <div className="panel p-5 text-sm text-red-700">
        Не хватает параметров задания или запуска распознавания.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Проверка распознанной структуры</h1>
          <p className="mt-1 text-sm text-slate-600">
            {assignment.data?.title || 'Эталонное задание'} · статус: {run.data?.status ?? 'загрузка'}
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

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(380px,1fr)]">
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
            Распознанная структура
          </div>
          <div className="p-4">
            {isRunning ? <RunningState /> : null}
            {run.data?.status === 'failed' ? (
              <FailedState
                message={run.data.error_message ?? 'Не удалось распознать задание.'}
                onRetry={() => restart.mutate()}
                retrying={restart.isPending}
              />
            ) : null}
            {run.data?.status === 'succeeded' && parsed ? <ParsedResult parsed={parsed} /> : null}
          </div>
        </div>
      </section>
    </div>
  );
}

function RunningState() {
  return (
    <div className="flex min-h-72 flex-col items-center justify-center gap-3 text-center text-sm text-slate-600">
      <Loader2 className="h-8 w-8 animate-spin text-cyan-700" aria-hidden="true" />
      Распознаем изображение...
    </div>
  );
}

function FailedState({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying: boolean }) {
  return (
    <div className="space-y-4 rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-700" aria-hidden="true" />
        <div>
          <div className="font-medium text-red-900">Не удалось распознать задание</div>
          <div className="mt-1 text-sm text-red-800">{message}</div>
        </div>
      </div>
      <button className="btn-secondary" disabled={retrying} onClick={onRetry} type="button">
        {retrying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}
        Попробовать снова
      </button>
    </div>
  );
}

function ParsedResult({ parsed }: { parsed: ParsedAssignment }) {
  const warnings = parsed.warnings ?? [];
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
        <div className="flex items-center gap-2 font-medium">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Распознавание завершено
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Info label="Title" value={parsed.title ?? 'Без названия'} />
        <Info label="Subject" value={parsed.subject} />
        <Info label="Language" value={parsed.detected_language} />
        <Info label="Level" value={parsed.estimated_level} />
      </dl>

      {warnings.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="text-sm font-medium text-amber-950">Предупреждения</div>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {warnings.map((warning, index) => (
              <li key={`${warning.type}-${index}`}>{warning.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-ink">Sections</h2>
        {parsed.sections.map((section) => (
          <SectionView key={section.id} section={section} />
        ))}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <dt className="text-xs font-medium uppercase text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function SectionView({ section }: { section: ParsedSection }) {
  const itemRows = useMemo(() => section.items ?? [], [section.items]);
  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white">{section.type}</span>
        <span className="text-sm font-medium text-slate-900">{section.title || section.id}</span>
      </div>
      <div className="space-y-2 text-sm text-slate-700">
        {section.instruction ? <p>{section.instruction}</p> : null}
        {section.text ? <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3">{section.text}</p> : null}
        {itemRows.length > 0 ? (
          <div className="space-y-2">
            {itemRows.map((item, index) => (
              <ItemView key={String(item.id ?? index)} item={item} />
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function ItemView({ item }: { item: Record<string, unknown> }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="mb-2 text-xs font-medium uppercase text-slate-500">{String(item.id ?? 'item')}</div>
      <pre className="whitespace-pre-wrap break-words text-xs leading-5 text-slate-800">
        {JSON.stringify(itemWithoutID(item), null, 2)}
      </pre>
    </div>
  );
}

function itemWithoutID(item: Record<string, unknown>) {
  const copy = { ...item };
  delete copy.id;
  return copy;
}
