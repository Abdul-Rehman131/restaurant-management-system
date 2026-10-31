import { Navigate, Outlet, useLocation } from 'react-router';

import { useAuth } from '../auth/auth-context';
import { paths } from '../paths';
import { SettingsProvider } from '../settings/SettingsProvider';
import { ConnectionProvider } from './ConnectionProvider';
import { FullScreenLoading } from './guards';
import { useStaffStatus } from './useStaffStatus';

// Lazy route: the data and Realtime clients load here, after sign-in, not with the login
// screen (plan 4.10 budgets).

/**
 * Signed-in area. Unauthenticated users go to /login (and come back afterwards). The role
 * claim only picks screens: the database checks my_role() on every request.
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
  return <SignedInShell />;
}

/**
 * Providers for every signed-in screen, plus the account check: inactive signs out, an Admin
 * with the second sign-in step pending goes to /login/mfa (the server decides: off only while
 * settings.require_admin_mfa is off), and a temporary password must be changed before any
 * other screen (S6). Screens wait for the first answer, unless it fails (offline).
 */
function SignedInShell() {
  const { account, settled } = useStaffStatus();
  const { pathname } = useLocation();
  if (!settled) return <FullScreenLoading />;
  if (account?.mfa_step) return <Navigate to={paths.mfa} replace />;
  if (account?.password_change && pathname !== paths.changePassword) {
    return <Navigate to={paths.changePassword} replace />;
  }
  return (
    <SettingsProvider>
      <ConnectionProvider>
        <Outlet />
      </ConnectionProvider>
    </SettingsProvider>
  );
}

export { RequireAuth as Component };
