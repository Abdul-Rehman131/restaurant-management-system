import { parseSettings, PublicSettingsProvider } from '@rms/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { useAuth, type AppRole } from '../auth/auth-context';
import { isNotAuthorized } from '../auth/errors';
import { db } from '../lib/db';

const settingsQueryKey = ['settings'] as const;

/** Roles get_settings serves (migration role_scoped_rpcs). Riders get nothing until P3. */
const settingsRoles: readonly AppRole[] = ['admin', 'cashier', 'waiter', 'chef'];

async function fetchSettings() {
  const { data, error } = await db.rpc('get_settings');
  if (error) throw error;
  return parseSettings(data);
}

/**
 * Business values (restaurant name, currency, ...) for signed-in screens, from the get_settings
 * RPC, validated by the Zod schema in @rms/shared. Never hardcoded in the UI. Whether the
 * account is still active is a separate check (useStaffStatus, my_role()).
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { role } = useAuth();
  const enabled = role !== null && settingsRoles.includes(role);
  const { data, isPending } = useQuery({
    queryKey: settingsQueryKey,
    queryFn: fetchSettings,
    enabled,
    staleTime: 5 * 60_000,
    // A weak connection gets a few tries; a NOT_AUTHORIZED answer never changes, so no retry.
    retry: (count, err) => !isNotAuthorized(err) && count < 3,
  });

  return (
    <PublicSettingsProvider value={{ settings: data ?? null, loading: enabled && isPending }}>
      {children}
    </PublicSettingsProvider>
  );
}
