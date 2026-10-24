import { createBrowserRouter, type RouteObject } from 'react-router';

import { App } from './App';

// The /dev/ui component gallery exists only in development builds: with import.meta.env.DEV
// false, this route and its chunk are not built (`pnpm size` checks the marker).
const devRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: '/dev/ui',
        lazy: async () => ({ Component: (await import('./dev/UiGallery')).default }),
      },
    ]
  : [];

export const router = createBrowserRouter([{ path: '/', element: <App /> }, ...devRoutes]);
