import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

type ThemeMode = 'light' | 'dark';

type Preferences = {
  theme: ThemeMode;
  accessible: boolean;
  toggleTheme: () => void;
  toggleAccessible: () => void;
};

const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('variantor-theme') === 'dark' ? 'dark' : 'light'));
  const [accessible, setAccessible] = useState(() => localStorage.getItem('variantor-accessible') === 'true');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.accessible = accessible ? 'true' : 'false';
    localStorage.setItem('variantor-theme', theme);
    localStorage.setItem('variantor-accessible', String(accessible));
  }, [theme, accessible]);

  const value = useMemo(
    () => ({
      theme,
      accessible,
      toggleTheme: () => setTheme((current) => (current === 'dark' ? 'light' : 'dark')),
      toggleAccessible: () => setAccessible((current) => !current),
    }),
    [theme, accessible],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) {
    throw new Error('usePreferences must be used inside PreferencesProvider');
  }
  return value;
}
