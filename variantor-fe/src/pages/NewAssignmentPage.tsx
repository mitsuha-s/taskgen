import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { FileText, ImagePlus, Loader2, UploadCloud } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, userMessage } from '../lib/api';

const maxFileSize = 10 * 1024 * 1024;
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];

const schema = z.object({
  title: z.string().max(160, 'Название слишком длинное.').optional(),
  file: z.custom<FileList | undefined>(),
  useDefaultSource: z.boolean().optional(),
}).superRefine((value, ctx) => {
  if (value.useDefaultSource === true) {
    return;
  }
  const files = value.file;
  if (!files || files.length !== 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['file'], message: 'Выберите одно изображение.' });
    return;
  }
  if (!allowedTypes.includes(files[0]?.type)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['file'], message: 'Поддерживаются только PNG, JPG и WEBP.' });
  }
  if ((files[0]?.size ?? 0) > maxFileSize) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['file'], message: 'Размер файла должен быть до 10 MB.' });
  }
});

type FormValues = z.infer<typeof schema>;

export default function NewAssignmentPage() {
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [stepOneModel, setStepOneModel] = useState<'lite' | 'pro'>('pro');

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      title: '',
      useDefaultSource: false,
    },
  });

  const createAssignment = useMutation({ mutationFn: api.createAssignment });
  const uploadImage = useMutation({
    mutationFn: ({ assignmentId, file }: { assignmentId: string; file: File }) =>
      api.uploadImage(assignmentId, file),
  });
  const startExtraction = useMutation({
    mutationFn: ({ assignmentId, options }: { assignmentId: string; options?: { use_default_source?: boolean; step_model?: 'lite' | 'pro' } }) =>
      api.startExtraction(assignmentId, options),
  });
  const isSubmitting = createAssignment.isPending || uploadImage.isPending || startExtraction.isPending;

  const watchedFiles = useWatch({ control: form.control, name: 'file' });
  const useDefaultSource = useWatch({ control: form.control, name: 'useDefaultSource' }) ?? false;
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
      const assignment = await createAssignment.mutateAsync(values.title ?? '');
      const useDefaultSource = values.useDefaultSource === true;
      if (!useDefaultSource && values.file?.[0]) {
        await uploadImage.mutateAsync({ assignmentId: assignment.id, file: values.file[0] });
      }
      const run = await startExtraction.mutateAsync({
        assignmentId: assignment.id,
        options: {
          use_default_source: useDefaultSource,
          step_model: stepOneModel,
        },
      });
      navigate(`/assignments/${assignment.id}/review?run=${run.extraction_run_id}`);
    } catch (error) {
      setSubmitError(userMessage(error));
    }
  }

  return (
    <div className="space-y-7">
      <div className="flex flex-col gap-4 rounded-xl bg-[linear-gradient(135deg,#266f85_0%,#5b7cfa_52%,#ff8a7a_100%)] p-6 text-white shadow-[0_22px_60px_rgba(91,124,250,0.22)] lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-honey">Новый материал</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight">Создать варианты задания</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/78">
            Загрузите эталон или включите тестовый HTML, затем проверьте параметры и получите готовые варианты для печати.
          </p>
        </div>
        <div className="flex items-center gap-3 rounded-lg bg-white/12 px-4 py-3 text-sm text-white/86">
          <FileText className="h-5 w-5 text-honey" aria-hidden="true" />
          HTML → варианты → PDF
        </div>
      </div>

      <form className="grid gap-6 xl:grid-cols-[minmax(520px,0.72fr)_minmax(420px,0.55fr)] 2xl:grid-cols-[minmax(640px,0.78fr)_minmax(480px,0.5fr)]" onSubmit={form.handleSubmit(onSubmit)}>
        <section className="panel p-5 sm:p-6">
          <div className="space-y-5">
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
              <div className="flex items-center justify-between gap-3">
                <label className="label" htmlFor="file">
                  Изображение задания
                </label>
                {useDefaultSource ? <span className="rounded-full bg-[linear-gradient(135deg,#e7e5ff,#dff7ff)] px-3 py-1 text-xs font-semibold text-leaf">Демо HTML</span> : null}
              </div>
              <label
                className={`flex min-h-40 flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-4 py-8 text-center transition ${
                  useDefaultSource
                    ? 'cursor-not-allowed border-slate-200 bg-[linear-gradient(135deg,#f8fafc,#e7e5ff)] text-slate-400'
                    : 'cursor-pointer border-slate-300 bg-[linear-gradient(135deg,#ffffff,#f7f5ff)] hover:border-leaf hover:bg-moss/30'
                }`}
                htmlFor="file"
              >
                <ImagePlus className="h-8 w-8 text-leaf" aria-hidden="true" />
                <span className="text-sm font-medium text-slate-800">{selectedFileLabel}</span>
                <span className="text-xs text-slate-500">PNG, JPG, WEBP до 10 MB</span>
              </label>
              <input
                id="file"
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={useDefaultSource}
                {...form.register('file')}
              />
              {form.formState.errors.file ? (
                <p className="text-sm text-red-700">{form.formState.errors.file.message}</p>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="label">Модель для шага 1</span>
                <select className="field" value={stepOneModel} onChange={(event) => setStepOneModel(event.target.value as 'lite' | 'pro')}>
                  <option value="pro">Pro</option>
                  <option value="lite">Lite</option>
                </select>
              </label>
              <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-[linear-gradient(135deg,#ffffff,#f7f5ff)] px-3 py-2 text-sm text-slate-800">
                <input type="checkbox" {...form.register('useDefaultSource')} />
                <span>Использовать дефолтный HTML вместо фото (временно)</span>
              </label>
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
          <div className="section-title">Предпросмотр</div>
          <div className="flex min-h-[420px] items-center justify-center bg-[linear-gradient(135deg,#fff7ed,#f7f5ff_48%,#e9fbff)] p-4">
            {previewURL ? (
              <img
                className="max-h-[720px] w-full rounded-lg object-contain shadow-sm"
                src={previewURL}
                alt="Предпросмотр выбранного задания"
              />
            ) : (
              <div className="max-w-xs text-center text-sm leading-6 text-slate-500">
                {useDefaultSource ? 'Будет использован встроенный HTML-шаблон без загрузки фото.' : 'Изображение появится после выбора файла.'}
              </div>
            )}
          </div>
        </aside>
      </form>
    </div>
  );
}
