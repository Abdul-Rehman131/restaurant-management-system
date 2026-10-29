import { createBrowserRouter, type RouteObject } from 'react-router';

import { paths } from './paths';
import { NotAvailableScreen, NotFoundScreen, RouteErrorScreen } from './screens/InfoScreens';
import { FullScreenLoading, RequireRole, RoleHomeRedirect } from './shell/guards';
import { Root } from './shell/Root';

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
          { path: paths.changePassword, lazy: () => import('./screens/ChangePasswordScreen') },
          // One lazy chunk per role: a waiter never downloads the cashier or admin screens. Each
          // role has its own error boundary (a crash or a chunk that fails to load shows the
          // Reload screen), and unknown addresses inside a role show "not found" (S6).
          {
            path: `${paths.waiter}/*`,
            element: <RequireRole allow="waiter" />,
            errorElement: <RouteErrorScreen />,
            children: [{ path: '*', lazy: () => import('./roles/waiter/WaiterApp') }],
          },
          {
            path: `${paths.kitchen}/*`,
            element: <RequireRole allow="chef" />,
            errorElement: <RouteErrorScreen />,
            // One screen: anything below /kitchen is an unknown address.
            children: [
              { index: true, lazy: () => import('./roles/kitchen/KitchenApp') },
              { path: '*', element: <NotFoundScreen /> },
            ],
          },
          {
            path: `${paths.cashier}/*`,
            element: <RequireRole allow="cashier" />,
            errorElement: <RouteErrorScreen />,
            children: [{ path: '*', lazy: () => import('./roles/cashier/CashierApp') }],
          },
          {
            path: `${paths.admin}/*`,
            element: <RequireRole allow="admin" />,
            errorElement: <RouteErrorScreen />,
            children: [{ path: '*', lazy: () => import('./roles/admin/AdminApp') }],
          },
          { path: '*', element: <NotFoundScreen /> },
        ],
      },
    ],
  },
]);
