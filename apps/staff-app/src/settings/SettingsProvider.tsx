import { parseSettings, PublicSettingsProvider } from '@rms/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';

import { useAuth } from '../auth/auth-context';
import { isNotAuthorized } from '../auth/errors';
import { db } from '../lib/db';

const settingsQueryKey = ['settings'] as const;

async function fetchSettings() {
  const { data, error } = await db.rpc('get_settings');
  if (error) throw error;
  return parseSettings(data);
}

/**
 * Business values (restaurant name, currency, ...) for signed-in screens, from the get_settings
 * RPC, validated by the Zod schema in @rms/shared. Never hardcoded in the UI. A NOT_AUTHORIZED
 * answer means the account was deactivated (my_role() is NULL): sign out and say so.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { signOut } = useAuth();
  const { data, isPending, error } = useQuery({
    queryKey: settingsQueryKey,
    queryFn: fetchSettings,
    staleTime: 5 * 60_000,
    retry: (count, err) => !isNotAuthorized(err) && count < 1,
  });

  useEffect(() => {
    if (isNotAuthorized(error)) void signOut('inactive');
  }, [error, signOut]);

  return (
    <PublicSettingsProvider value={{ settings: data ?? null, loading: isPending }}>
      {children}
    </PublicSettingsProvider>
  );
}
