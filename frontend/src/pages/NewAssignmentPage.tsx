import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { ImagePlus, Loader2, UploadCloud } from 'lucide-react';
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
      <div>
        <h1 className="text-2xl font-semibold text-ink">Новое эталонное задание</h1>
        <p className="mt-1 text-sm text-slate-600">Загрузите одно изображение задания для распознавания.</p>
      </div>

      <form className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,420px)]" onSubmit={form.handleSubmit(onSubmit)}>
        <section className="panel p-5">
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
              <label className="label" htmlFor="file">
                Изображение задания
              </label>
              <label
                className="flex min-h-40 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition hover:border-cyan-700 hover:bg-cyan-50/40"
                htmlFor="file"
              >
                <ImagePlus className="h-8 w-8 text-cyan-700" aria-hidden="true" />
                <span className="text-sm font-medium text-slate-800">{selectedFileLabel}</span>
                <span className="text-xs text-slate-500">PNG, JPG, WEBP до 10 MB</span>
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
          <div className="border-b border-slate-200 px-4 py-3 text-sm font-medium text-slate-800">Предпросмотр</div>
          <div className="flex min-h-80 items-center justify-center bg-slate-100 p-4">
            {previewURL ? (
              <img
                className="max-h-[560px] w-full rounded-md object-contain"
                src={previewURL}
                alt="Предпросмотр выбранного задания"
              />
            ) : (
              <div className="text-center text-sm text-slate-500">Изображение появится после выбора файла.</div>
            )}
          </div>
        </aside>
      </form>
    </div>
  );
}
