import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BookOpenCheck, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { api, userMessage } from '../lib/api';

const schema = z.object({
  email: z.string().email('Введите корректный email.'),
  password: z.string().min(1, 'Введите пароль.'),
});

type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const from = (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/assignments/new';

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      email: 'teacher@example.com',
      password: 'secret',
    },
  });

  const login = useMutation({
    mutationFn: (values: FormValues) => api.login(values.email, values.password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate(from, { replace: true });
    },
  });

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <section className="panel grid w-full max-w-4xl overflow-hidden md:grid-cols-[1fr_0.85fr]">
        <div className="flex min-h-[420px] flex-col justify-between bg-[linear-gradient(145deg,#266f85_0%,#5b7cfa_52%,#ff8a7a_100%)] p-7 text-white">
          <div>
            <span className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/15">
              <BookOpenCheck className="h-6 w-6" aria-hidden="true" />
            </span>
            <h1 className="mt-7 max-w-sm text-3xl font-bold leading-tight">Генерация вариантов заданий без ручной рутины</h1>
          </div>
          <p className="max-w-sm text-sm leading-6 text-white/78">
            Загружайте эталон, проверяйте параметры, выбирайте модель и скачивайте готовые варианты в PDF.
          </p>
        </div>
        <div className="p-6 sm:p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold text-ink">Вход</h2>
            <p className="mt-1 text-sm text-slate-600">Используйте учетные данные из backend-конфига.</p>
          </div>

          <form className="space-y-4" onSubmit={form.handleSubmit((values) => login.mutate(values))}>
            <div className="space-y-1.5">
              <label className="label" htmlFor="email">
                Email
              </label>
              <input id="email" className="field" type="email" autoComplete="email" {...form.register('email')} />
              {form.formState.errors.email ? (
                <p className="text-sm text-red-700">{form.formState.errors.email.message}</p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <label className="label" htmlFor="password">
                Пароль
              </label>
              <input
                id="password"
                className="field"
                type="password"
                autoComplete="current-password"
                {...form.register('password')}
              />
              {form.formState.errors.password ? (
                <p className="text-sm text-red-700">{form.formState.errors.password.message}</p>
              ) : null}
            </div>

            {login.isError ? <p className="text-sm text-red-700">{userMessage(login.error)}</p> : null}

            <button className="btn-primary w-full" disabled={login.isPending} type="submit">
              {login.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Войти
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
