import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { AppShell } from './components/AppShell';
import { isUnauthorized, useMe } from './lib/hooks';
import LoginPage from './pages/LoginPage';
import GalleryPage from './pages/GalleryPage';
import NewAssignmentPage from './pages/NewAssignmentPage';
import ReviewPage from './pages/ReviewPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const me = useMe();

  if (me.isLoading) {
    return <div className="min-h-screen bg-paper p-6 text-sm text-slate-600">Проверяем сессию...</div>;
  }

  if (me.isError && isUnauthorized(me.error)) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <AppShell>{children}</AppShell>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/assignments"
        element={
          <RequireAuth>
            <GalleryPage />
          </RequireAuth>
        }
      />
      <Route
        path="/assignments/new"
        element={
          <RequireAuth>
            <NewAssignmentPage />
          </RequireAuth>
        }
      />
      <Route
        path="/assignments/:id/review"
        element={
          <RequireAuth>
            <ReviewPage />
          </RequireAuth>
        }
      />
      <Route path="/" element={<Navigate to="/assignments" replace />} />
      <Route path="*" element={<Navigate to="/assignments" replace />} />
    </Routes>
  );
}
