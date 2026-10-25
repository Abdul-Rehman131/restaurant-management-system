import { AuthClient } from '@supabase/auth-js';

import { supabaseKey, supabaseUrl } from './env';

/**
 * Supabase Auth, the only Supabase piece the login screen needs. The data and Realtime clients
 * live in ./db and load with the signed-in shell, so the login bundle stays small (plan 4.10).
 * Together they are what @supabase/supabase-js wires up, minus Storage and Functions (unused
 * by staff screens until P1).
 */
export const auth = new AuthClient({
  url: `${supabaseUrl}/auth/v1`,
  headers: { apikey: supabaseKey },
  storageKey: 'rms-staff-auth',
  persistSession: true,
  autoRefreshToken: true,
  // Staff sign in with a password; there are no magic links or OAuth redirects.
  detectSessionInUrl: false,
});

/** The current access token for data and Realtime requests (refreshed by auth). */
export async function accessToken(): Promise<string | null> {
  const { data } = await auth.getSession();
  return data.session?.access_token ?? null;
}
