import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
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
      <section className="panel w-full max-w-sm p-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-ink">Вход для учителя</h1>
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
      </section>
    </main>
  );
}
