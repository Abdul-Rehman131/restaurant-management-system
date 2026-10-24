import './i18n';
import './index.css';

import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App';

// /dev/ui: the component gallery (T7). Development builds only; import.meta.env.DEV is false
// in production, so the gallery chunk is never built. The router arrives in T8.
const UiGallery = import.meta.env.DEV ? lazy(() => import('./dev/UiGallery')) : null;
const showGallery = UiGallery !== null && window.location.pathname === '/dev/ui';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from index.html');

createRoot(root).render(
  <StrictMode>
    {showGallery ? (
      <Suspense>
        <UiGallery />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
