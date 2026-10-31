import './i18n';
import './index.css';

import { UiProvider } from '@rms/ui';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { queryClient } from './lib/queryClient';
import { router } from './router';
import { ThemeProvider } from './shell/ThemeProvider';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <UiProvider>
          <RouterProvider router={router} />
        </UiProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Service worker and "update available" toast, after the first screen (production only).
if (import.meta.env.PROD)
  void import('./shell/pwa').then(({ registerPwa }) => {
    registerPwa();
  });

// Error reporting only when a DSN is set at build time; otherwise this code is not built
// (src/lib/sentry.ts).
if (import.meta.env.VITE_SENTRY_DSN) void import('./lib/sentry');
