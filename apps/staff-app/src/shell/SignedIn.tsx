import { Navigate, Outlet, useLocation } from 'react-router';

import { needsMfaStep, useAuth } from '../auth/auth-context';
import { paths } from '../paths';
import { SettingsProvider } from '../settings/SettingsProvider';
import { ConnectionProvider } from './ConnectionProvider';
import { FullScreenLoading } from './guards';

// Lazy route: the data and Realtime clients load here, after sign-in, not with the login
// screen (plan 4.10 budgets).

/**
 * Signed-in area. Unauthenticated users go to /login (and come back afterwards); an Admin with
 * an MFA step pending goes to /login/mfa. The role claim only picks screens: the database
 * checks my_role() on every request.
 */
export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') return <FullScreenLoading />;
  if (auth.status === 'signedOut') {
    return (
      <Navigate to={paths.login} replace state={{ from: location.pathname + location.search }} />
    );
  }
  if (needsMfaStep(auth)) return <Navigate to={paths.mfa} replace />;

  return (
    <SettingsProvider>
      <ConnectionProvider>
        <Outlet />
      </ConnectionProvider>
    </SettingsProvider>
  );
}

export { RequireAuth as Component };
