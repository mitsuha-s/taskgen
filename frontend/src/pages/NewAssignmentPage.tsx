import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Cpu, FileImage, Gauge, ImagePlus, Loader2, ScanLine, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, userMessage } from '../lib/api';

const maxFileSize = 10 * 1024 * 1024;
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

const schema = z.object({
  title: z.string().max(160, 'Название слишком длинное.').optional(),
  file: z
    .custom<FileList>()
    .refine((files) => files?.length === 1, 'Выберите одно изображение.')
    .refine((files) => allowedTypes.includes(files?.[0]?.type), 'Поддерживаются только PNG, JPG и WEBP.')
    .refine((files) => files?.[0]?.size <= maxFileSize, 'Размер файла должен быть до 10 MB.'),
});

type FormValues = z.infer<typeof schema>;

export default function NewAssignmentPage() {
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
    },
  });

  const createAssignment = useMutation({ mutationFn: api.createAssignment });
  const uploadImage = useMutation({
    mutationFn: ({ assignmentId, file }: { assignmentId: string; file: File }) =>
      api.uploadImage(assignmentId, file),
  });
  const startExtraction = useMutation({ mutationFn: api.startExtraction });
  const isSubmitting = createAssignment.isPending || uploadImage.isPending || startExtraction.isPending;

  const watchedFiles = useWatch({ control: form.control, name: 'file' });
  const selectedFile = watchedFiles?.[0];
  const selectedFileLabel = useMemo(() => {
    if (!selectedFile) {
      return 'Файл не выбран';
    }
    const sizeMB = selectedFile.size / 1024 / 1024;
    return `${selectedFile.name} · ${sizeMB.toFixed(2)} MB`;
  }, [selectedFile]);
  const previewURL = useMemo(() => {
    if (!selectedFile) {
      return null;
    }
    return URL.createObjectURL(selectedFile);
  }, [selectedFile]);

  useEffect(() => {
    return () => {
      if (previewURL) {
        URL.revokeObjectURL(previewURL);
      }
    };
  }, [previewURL]);

  async function onSubmit(values: FormValues) {
    setSubmitError(null);
    try {
      const file = values.file[0];
      const assignment = await createAssignment.mutateAsync(values.title ?? '');
      await uploadImage.mutateAsync({ assignmentId: assignment.id, file });
      const run = await startExtraction.mutateAsync(assignment.id);
      navigate(`/assignments/${assignment.id}/review?run=${run.extraction_run_id}`);
    } catch (error) {
      setSubmitError(userMessage(error));
    }
  }

  return (
    <div className="space-y-6">
      <section className="surface-dark machine-grid overflow-hidden p-5 sm:p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <span className="status-chip border-cyan-300/30 bg-white/[0.08] text-cyan-100">
              <Cpu className="h-3.5 w-3.5" aria-hidden="true" />
              AI-ввод
            </span>
            <h1 className="mt-4 text-2xl font-semibold leading-tight text-white sm:text-3xl">Новое эталонное задание</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">Загрузите изображение, чтобы запустить распознавание и сборку нового варианта.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[460px]">
            <HeaderMetric icon={FileImage} label="Форматы" value="PNG JPG WEBP" />
            <HeaderMetric icon={Gauge} label="Лимит" value="10 MB" />
            <HeaderMetric icon={ScanLine} label="Режим" value="Vision AI" />
          </div>
        </div>
      </section>

      <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]" onSubmit={form.handleSubmit(onSubmit)}>
        <section className="panel overflow-hidden">
          <div className="panel-heading flex items-center gap-2">
            <UploadCloud className="h-4 w-4 text-ai" aria-hidden="true" />
            Входные данные
          </div>
          <div className="space-y-5 p-5">
            <div className="space-y-1.5">
              <label className="label" htmlFor="title">
                Название
              </label>
              <input
                id="title"
                className="field"
                placeholder="Например: Unit 3 Grammar Test"
                {...form.register('title')}
              />
              {form.formState.errors.title ? (
                <p className="text-sm text-red-700">{form.formState.errors.title.message}</p>
              ) : null}
            </div>

            <div className="space-y-2">
              <label className="label" htmlFor="file">
                Изображение задания
              </label>
              <label
                className="scan-frame flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 border-dashed px-4 py-8 text-center transition hover:border-ai hover:bg-cyan-50/60"
                htmlFor="file"
              >
                <span className="relative z-10 flex h-12 w-12 items-center justify-center rounded-md border border-cyan-200 bg-white text-ai shadow-sm">
                  <ImagePlus className="h-6 w-6" aria-hidden="true" />
                </span>
                <span className="relative z-10 text-sm font-semibold text-slate-900">{selectedFileLabel}</span>
                <span className="relative z-10 text-xs font-medium uppercase text-slate-500">PNG, JPG, WEBP до 10 MB</span>
              </label>
              <input
                id="file"
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                {...form.register('file')}
              />
              {form.formState.errors.file ? (
                <p className="text-sm text-red-700">{form.formState.errors.file.message}</p>
              ) : null}
            </div>

            {submitError ? <p className="text-sm text-red-700">{submitError}</p> : null}

            <button className="btn-primary w-full sm:w-auto" disabled={isSubmitting} type="submit">
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <UploadCloud className="h-4 w-4" aria-hidden="true" />
              )}
              Начать обработку
            </button>
          </div>
        </section>

        <aside className="panel overflow-hidden">
          <div className="panel-heading flex items-center justify-between gap-3">
            <span>Предпросмотр</span>
            <span className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-semibold uppercase text-slate-500">
              Эталон
            </span>
          </div>
          <div className="scan-frame flex min-h-96 items-center justify-center rounded-none border-0 bg-slate-100 p-4">
            {previewURL ? (
              <img
                className="relative z-10 max-h-[560px] w-full rounded-md border border-slate-200 bg-white object-contain shadow-sm"
                src={previewURL}
                alt="Предпросмотр выбранного задания"
              />
            ) : (
              <div className="relative z-10 rounded-md border border-slate-200 bg-white/80 px-4 py-3 text-center text-sm text-slate-500 shadow-sm">
                Изображение появится после выбора файла.
              </div>
            )}
          </div>
        </aside>
      </form>
    </div>
  );
}

function HeaderMetric({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.08] p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase text-slate-400">
        <Icon className="h-3.5 w-3.5 text-cyan-200" aria-hidden="true" />
        {label}
      </div>
      <div className="mt-2 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}
