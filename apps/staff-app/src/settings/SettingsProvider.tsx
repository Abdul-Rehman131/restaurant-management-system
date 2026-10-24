import { parseSettings, PublicSettingsProvider } from '@rms/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { supabase } from '../lib/supabase';

export const settingsQueryKey = ['settings'] as const;

async function fetchSettings() {
  const { data, error } = await supabase.rpc('get_settings');
  if (error) throw error;
  return parseSettings(data);
}

/**
 * Business values (restaurant name, currency, ...) for signed-in screens, from the get_settings
 * RPC, validated by the Zod schema in @rms/shared. Never hardcoded in the UI.
 */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data, isPending } = useQuery({
    queryKey: settingsQueryKey,
    queryFn: fetchSettings,
    staleTime: 5 * 60_000,
  });
  return (
    <PublicSettingsProvider value={{ settings: data ?? null, loading: isPending }}>
      {children}
    </PublicSettingsProvider>
  );
}
