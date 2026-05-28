import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { FileText, Keyboard, Loader2, UploadCloud } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, ExtractionOptions, userMessage } from '../lib/api';

const maxFileSize = 10 * 1024 * 1024;
const allowedExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.pdf', '.doc', '.docx', '.txt'];
let uploadItemCounter = 0;

const schema = z.object({
  title: z.string().max(160, 'Название слишком длинное.').optional(),
});

type FormValues = z.infer<typeof schema>;
type UploadItem = { id: string; file: File };
type SourceMode = 'files' | 'manual';
export default function NewAssignmentPage() {
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [files, setFiles] = useState<UploadItem[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [sourceMode, setSourceMode] = useState<SourceMode>('files');
  const [manualText, setManualText] = useState('');

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '' },
  });

  const createAssignment = useMutation({ mutationFn: api.createAssignment });
  const uploadFiles = useMutation({
    mutationFn: ({ assignmentId, upload }: { assignmentId: string; upload: File[] }) =>
      api.uploadFiles(assignmentId, upload),
  });
  const startExtraction = useMutation({
    mutationFn: ({ assignmentId, options }: { assignmentId: string; options?: ExtractionOptions }) =>
      api.startExtraction(assignmentId, options),
  });

  const isSubmitting = createAssignment.isPending || uploadFiles.isPending || startExtraction.isPending;

  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (sourceMode === 'files' && pasted.length > 0) {
        event.preventDefault();
        appendFiles(pasted);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [sourceMode]);

  useEffect(() => {
    function hasFiles(event: DragEvent) {
      return Array.from(event.dataTransfer?.types ?? []).includes('Files');
    }
    function onDragEnter(event: DragEvent) {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      setDragDepth((value) => value + 1);
      setIsDragActive(true);
    }
    function onDragOver(event: DragEvent) {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'copy';
      }
    }
    function onDragLeave(event: DragEvent) {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      setDragDepth((value) => {
        const next = Math.max(0, value - 1);
        if (next === 0) {
          setIsDragActive(false);
        }
        return next;
      });
    }
    function onDrop(event: DragEvent) {
      if (!hasFiles(event)) {
        return;
      }
      event.preventDefault();
      setDragDepth(0);
      setIsDragActive(false);
      if (sourceMode === 'files') {
        appendFiles(Array.from(event.dataTransfer?.files ?? []));
      }
    }

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [sourceMode]);

  function appendFiles(incoming: File[]) {
    const accepted = incoming.filter((file) => {
      const dotIndex = file.name.lastIndexOf('.');
      const ext = dotIndex >= 0 ? file.name.slice(dotIndex).toLowerCase() : '';
      return allowedExtensions.includes(ext) && file.size <= maxFileSize;
    });
    if (accepted.length === 0) {
      return;
    }
    setFiles((current) => [
      ...current,
      ...accepted.map((file) => ({ id: createUploadItemId(file), file })),
    ]);
    if (submitError) {
      setSubmitError(null);
    }
  }

  function createUploadItemId(file: File) {
    uploadItemCounter += 1;
    const randomPart = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${uploadItemCounter}`;
    return `${randomPart}-${file.name}-${file.size}`;
  }

  function moveItem(sourceId: string, targetId: string) {
    setFiles((current) => {
      const sourceIndex = current.findIndex((item) => item.id === sourceId);
      const targetIndex = current.findIndex((item) => item.id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
  }

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    const cleanManualText = manualText.trim();
    if (sourceMode === 'files' && files.length === 0) {
      setSubmitError('Добавьте хотя бы один файл.');
      return;
    }
    if (sourceMode === 'manual' && !cleanManualText) {
      setSubmitError('Введите текст задания.');
      return;
    }
    try {
      const assignment = await createAssignment.mutateAsync(values.title ?? '');
      if (sourceMode === 'files') {
        await uploadFiles.mutateAsync({ assignmentId: assignment.id, upload: files.map((item) => item.file) });
      }
      const run = await startExtraction.mutateAsync({
        assignmentId: assignment.id,
        options: sourceMode === 'manual' ? { manual_source_text: cleanManualText } : {},
      });
      navigate(`/assignments/${assignment.id}/review?run=${run.extraction_run_id}`);
    } catch (error) {
      setSubmitError(userMessage(error));
    }
  }

  return (
    <div className="space-y-7">
      {isDragActive ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55">
          <div className="rounded-xl border border-white/30 bg-white/10 px-8 py-6 text-center text-xl font-semibold text-white">
            Перетащите файлы сюда для их загрузки
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-4 rounded-xl bg-[linear-gradient(135deg,#266f85_0%,#5b7cfa_52%,#ff8a7a_100%)] p-6 text-white shadow-[0_22px_60px_rgba(91,124,250,0.22)] lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-honey">Новый материал</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Создать варианты задания</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/78">Поддерживаются изображения, PDF, DOC/DOCX, TXT и ручной ввод.</p>
        </div>
        <div className="flex items-center gap-3 rounded-lg bg-white/12 px-4 py-3 text-sm text-white/86">
          <FileText className="h-5 w-5 text-honey" aria-hidden="true" />
          HTML → варианты → PDF
        </div>
      </div>

      <form className="grid gap-6" onSubmit={form.handleSubmit(onSubmit)}>
        <section className="panel p-5 sm:p-6">
          <div className="space-y-5">
            <div className="space-y-1.5">
              <label className="label" htmlFor="title">Название</label>
              <input id="title" className="field" placeholder="Например: Unit 3 Grammar Test" {...form.register('title')} />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                className={`btn-secondary ${sourceMode === 'files' ? 'border-leaf bg-[linear-gradient(135deg,#e7e5ff,#dff7ff)] text-leaf' : ''}`}
                type="button"
                onClick={() => setSourceMode('files')}
              >
                <UploadCloud className="h-4 w-4" aria-hidden="true" />
                Загрузить файлы
              </button>
              <button
                className={`btn-secondary ${sourceMode === 'manual' ? 'border-leaf bg-[linear-gradient(135deg,#e7e5ff,#dff7ff)] text-leaf' : ''}`}
                type="button"
                onClick={() => setSourceMode('manual')}
              >
                <Keyboard className="h-4 w-4" aria-hidden="true" />
                Ввести вручную
              </button>
            </div>

            {sourceMode === 'files' ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="label" htmlFor="file-input">Файлы задания</label>
                  </div>
                  <label className="flex min-h-28 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-[linear-gradient(135deg,#ffffff,#f7f5ff)] px-4 py-6 text-center transition hover:border-leaf hover:bg-moss/30" htmlFor="file-input">
                    <span className="text-sm font-medium text-slate-800">Нажмите или перетащите файлы</span>
                    <span className="text-xs text-slate-500">PNG, JPG, WEBP, PDF, DOC, DOCX, TXT до 10 MB каждый</span>
                  </label>
                  <input
                    id="file-input"
                    className="sr-only"
                    type="file"
                    multiple
                    accept=".png,.jpg,.jpeg,.webp,.pdf,.doc,.docx,.txt"
                    onChange={(event) => appendFiles(Array.from(event.target.files ?? []))}
                  />
                </div>

                <div className="space-y-2 rounded-lg border border-slate-200/90 bg-white/70 p-3">
                  <div className="text-sm font-semibold text-slate-800">Порядок файлов</div>
                  <div className="space-y-2">
                    {files.map((item, index) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                        draggable
                        onDragStart={() => setDraggedId(item.id)}
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() => {
                          if (draggedId) {
                            moveItem(draggedId, item.id);
                          }
                          setDraggedId(null);
                        }}
                      >
                        <span>{index + 1}. {item.file.name}</span>
                        <button
                          className="text-xs text-red-600"
                          type="button"
                          onClick={() => setFiles((current) => current.filter((entry) => entry.id !== item.id))}
                        >
                          Удалить
                        </button>
                      </div>
                    ))}
                    {files.length === 0 ? <div className="text-sm text-slate-500">Файлы не добавлены.</div> : null}
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <label className="label" htmlFor="manual-source">Текст задания</label>
                <textarea
                  id="manual-source"
                  className="field min-h-80"
                  value={manualText}
                  onChange={(event) => setManualText(event.target.value)}
                  placeholder="Вставьте исходный вариант задания целиком"
                />
              </div>
            )}

            {submitError ? <p className="text-sm text-red-700">{submitError}</p> : null}

            <button className="btn-primary w-full sm:w-auto" disabled={isSubmitting} type="submit">
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <UploadCloud className="h-4 w-4" aria-hidden="true" />}
              Начать обработку
            </button>
          </div>
        </section>

      </form>
    </div>
  );
}
