import { BrainCircuit, LogOut, Plus, ShieldCheck } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import { api } from '../lib/api';

type AppShellProps = {
  children: ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: api.logout,
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/login', { replace: true });
    },
  });

  return (
    <div className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-graphite/95 text-white shadow-lg shadow-slate-950/10 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link className="flex min-w-0 items-center gap-3" to="/assignments/new">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-cyan-300/[0.35] bg-white/[0.08] text-cyan-200 shadow-inner">
              <BrainCircuit className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-white">Ассистент учителя английского</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs font-medium text-slate-300">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-300" aria-hidden="true" />
                AI-конвейер вариантов
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-2">
            <Link className="btn-secondary h-9 border-slate-600 bg-white/10 px-3 text-white hover:border-cyan-300/50 hover:bg-white/15" to="/assignments/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Новое
            </Link>
            <button
              className="btn-secondary h-9 border-slate-600 bg-white/10 px-3 text-white hover:border-slate-500 hover:bg-white/15"
              onClick={() => logout.mutate()}
              type="button"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Выйти
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
