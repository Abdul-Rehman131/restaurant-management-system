import { createBrowserRouter, type RouteObject } from 'react-router';

import { paths } from './paths';
import { NotAvailableScreen, NotFoundScreen, RouteErrorScreen } from './screens/InfoScreens';
import { FullScreenLoading, RequireRole, RoleHomeRedirect } from './shell/guards';
import { RolePlaceholder, Root } from './shell/Root';

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

export const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteErrorScreen />,
    hydrateFallbackElement: <FullScreenLoading />,
    children: [
      { path: paths.login, lazy: () => import('./screens/LoginScreen') },
      { path: paths.mfa, lazy: () => import('./screens/MfaScreen') },
      ...devRoutes,
      {
        // Signed-in area: lazy, so the data and Realtime clients are not in the login bundle.
        lazy: () => import('./shell/SignedIn'),
        children: [
          { index: true, element: <RoleHomeRedirect /> },
          { path: paths.notAvailable, element: <NotAvailableScreen /> },
          ...(['waiter', 'kitchen', 'cashier', 'admin'] as const).map((area) => ({
            path: `/${area}/*`,
            element: <RequireRole role={area === 'kitchen' ? 'chef' : area} />,
            children: [{ path: '*', element: <RolePlaceholder /> }],
          })),
          { path: '*', element: <NotFoundScreen /> },
        ],
      },
    ],
  },
]);
