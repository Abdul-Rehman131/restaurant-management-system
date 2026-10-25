import { Outlet } from 'react-router';

import { AuthProvider } from '../auth/AuthProvider';

/** Top of the route tree: the session is known to every route. */
export function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  );
}
