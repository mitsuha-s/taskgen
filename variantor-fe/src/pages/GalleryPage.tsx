import { useQuery } from '@tanstack/react-query';
import { ArrowRight, FileText, Loader2, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

export default function GalleryPage() {
  const assignments = useQuery({
    queryKey: ['assignments'],
    queryFn: api.listAssignments,
  });

  if (assignments.isLoading) {
    return (
      <div className="flex min-h-60 items-center justify-center text-sm text-slate-600">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
        Загружаем галерею...
      </div>
    );
  }

  const items = assignments.data?.assignments ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Галерея вариантов</h1>
          <p className="mt-1 text-sm text-slate-600">Старые работы и последние результаты обработки.</p>
        </div>
        <Link className="btn-primary" to="/assignments/new">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Новое задание
        </Link>
      </div>

      {items.length === 0 ? (
        <section className="panel flex min-h-52 flex-col items-center justify-center gap-3 p-6 text-center">
          <FileText className="h-9 w-9 text-leaf" aria-hidden="true" />
          <div>
            <div className="font-semibold text-slate-900">Работ пока нет</div>
            <div className="mt-1 text-sm text-slate-600">Создайте первое задание, и оно появится здесь.</div>
          </div>
        </section>
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((assignment) => {
            const run = assignment.latest_extraction_run;
            const target = run ? `/assignments/${assignment.id}/review?run=${run.id}` : `/assignments/${assignment.id}/review`;
            return (
              <Link key={assignment.id} className="panel group block p-4 transition hover:-translate-y-0.5 hover:shadow-[0_22px_52px_rgba(23,32,51,0.12)]" to={target}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-base font-semibold text-slate-950">{assignment.title || 'Без названия'}</div>
                    <div className="mt-1 text-xs text-slate-500">{new Date(assignment.created_at).toLocaleString()}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-leaf" aria-hidden="true" />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-full bg-white/75 px-3 py-1 text-xs font-semibold text-slate-700">{statusLabel(assignment.status)}</span>
                  {run ? <span className="rounded-full bg-white/75 px-3 py-1 text-xs font-semibold text-leaf">{statusLabel(run.status)}</span> : null}
                </div>
              </Link>
            );
          })}
        </section>
      )}
    </div>
  );
}

function statusLabel(status: string) {
  switch (status) {
    case 'processed':
    case 'succeeded':
      return 'готово';
    case 'extracting':
    case 'running':
    case 'pending':
      return 'обрабатывается';
    case 'processing_waiting':
    case 'awaiting_confirmation':
      return 'нужна проверка';
    case 'extraction_failed':
    case 'failed':
      return 'ошибка';
    default:
      return status || 'создано';
  }
}
