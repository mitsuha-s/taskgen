import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import 'katex/dist/katex.min.css';
import App from './App';
import './index.css';
import { PreferencesProvider } from './lib/preferences';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PreferencesProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </PreferencesProvider>
    </QueryClientProvider>
  </StrictMode>,
);
