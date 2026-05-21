import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BrainCircuit, Loader2, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
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
    <main className="flex min-h-screen items-center justify-center bg-paper px-0 py-8 text-ink sm:px-6">
      <section className="grid min-w-0 w-full max-w-5xl overflow-hidden border-y border-slate-200 bg-white shadow-2xl shadow-slate-900/10 sm:rounded-lg sm:border lg:grid-cols-[1.1fr_0.9fr]">
        <div className="machine-grid relative hidden min-h-[620px] overflow-hidden p-8 text-white lg:block">
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-cyan-400 via-emerald-300 to-amber-300" />
          <div className="relative flex h-full flex-col justify-between">
            <div>
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-md border border-cyan-300/40 bg-white/[0.08] text-cyan-200">
                  <BrainCircuit className="h-6 w-6" aria-hidden="true" />
                </span>
                <div>
                  <div className="text-sm font-semibold">Ассистент учителя английского</div>
                  <div className="mt-1 text-xs font-medium uppercase text-slate-300">AI-консоль</div>
                </div>
              </div>
              <div className="mt-16 max-w-md">
                <h1 className="text-4xl font-semibold leading-tight tracking-normal">Промышленная сборка вариантов заданий</h1>
                <p className="mt-4 text-sm leading-6 text-slate-300">
                  Загрузка эталона, распознавание, контроль параметров и финальный PDF в одном рабочем контуре.
                </p>
              </div>
            </div>

            <div className="grid gap-3">
              {['Сканирование', 'Контроль', 'Вариант'].map((item, index) => (
                <div key={item} className="flex items-center justify-between rounded-md border border-white/10 bg-white/[0.07] px-4 py-3">
                  <span className="text-sm font-medium text-slate-100">{item}</span>
                  <span className="rounded border border-cyan-300/30 px-2 py-1 text-xs font-semibold text-cyan-100">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex min-h-[560px] min-w-0 items-center justify-center bg-slate-50/80 p-5 sm:p-8">
          <div className="min-w-0 w-[calc(100vw-2.5rem)] max-w-full sm:w-full sm:max-w-sm">
            <div className="mb-7">
              <span className="status-chip border-emerald-200 bg-emerald-50 text-emerald-800">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Защищенный вход
              </span>
              <h1 className="mt-4 text-2xl font-semibold text-ink">Вход для учителя</h1>
              <p className="mt-2 text-sm text-slate-600">Рабочий контур генерации вариантов</p>
            </div>

            <form className="space-y-4" onSubmit={form.handleSubmit((values) => login.mutate(values))}>
              <div className="space-y-1.5">
                <label className="label" htmlFor="email">
                  Email
                </label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input id="email" className="field pl-10" type="email" autoComplete="email" {...form.register('email')} />
                </div>
                {form.formState.errors.email ? (
                  <p className="text-sm text-red-700">{form.formState.errors.email.message}</p>
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label className="label" htmlFor="password">
                  Пароль
                </label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    id="password"
                    className="field pl-10"
                    type="password"
                    autoComplete="current-password"
                    {...form.register('password')}
                  />
                </div>
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
        </div>
      </section>
    </main>
  );
}
