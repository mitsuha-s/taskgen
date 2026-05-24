import { BookOpenCheck, LogOut, Plus } from 'lucide-react';
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
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-white/70 bg-[linear-gradient(90deg,rgba(255,255,255,0.86),rgba(231,229,255,0.76),rgba(223,247,255,0.78))] backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1680px] items-center justify-between px-4 sm:px-6 2xl:px-8">
          <Link className="flex items-center gap-3" to="/assignments/new">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[linear-gradient(135deg,#266f85,#5b7cfa_58%,#ff8a7a)] text-white shadow-sm shadow-leaf/20">
              <BookOpenCheck className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-bold text-ink">TaskGen</span>
              <span className="block text-xs text-slate-500">Ассистент учителя</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link className="btn-secondary h-9 px-3" to="/assignments/new">
              <Plus className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Новое</span>
            </Link>
            <button className="btn-secondary h-9 px-3" onClick={() => logout.mutate()} type="button">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Выйти</span>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1680px] px-4 py-6 sm:px-6 lg:py-8 2xl:px-8">{children}</main>
    </div>
  );
}
