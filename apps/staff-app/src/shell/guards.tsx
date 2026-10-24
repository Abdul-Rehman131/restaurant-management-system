import { SkeletonGroup } from '@rms/ui';
import { Navigate, Outlet } from 'react-router';

import { roleHome, useAuth, type AppRole } from '../auth/auth-context';
import { paths } from '../paths';

/** Shown while the stored session is read (a few milliseconds) and while role chunks load. */
export function FullScreenLoading() {
  return (
    <SkeletonGroup className="grid min-h-dvh place-items-center bg-bg">
      <span className="size-12 rounded-full bg-border/70" />
    </SkeletonGroup>
  );
}

/**
 * A role area. Any other role is sent to its own home. Admin may open every area (spec 4:
 * full access), but lands on /admin.
 */
export function RequireRole({ role }: { role: AppRole }) {
  const auth = useAuth();
  if (!auth.role) return <Navigate to={paths.notAvailable} replace />;
  if (auth.role !== role && auth.role !== 'admin') {
    return <Navigate to={roleHome[auth.role]} replace />;
  }
  return <Outlet />;
}

/** "/" and unknown roles: go to the signed-in user's home. */
export function RoleHomeRedirect() {
  const auth = useAuth();
  return <Navigate to={auth.role ? roleHome[auth.role] : paths.notAvailable} replace />;
}
