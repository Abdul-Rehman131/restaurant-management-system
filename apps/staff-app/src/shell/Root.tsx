import { usePublicSettings } from '@rms/shared';
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

// Placeholder role home until the role layouts land.
export function RolePlaceholder() {
  const { settings } = usePublicSettings();
  return <main className="p-6 text-2xl font-semibold">{settings?.restaurantName}</main>;
}
