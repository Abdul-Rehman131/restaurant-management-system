import type { Database } from '@rms/shared';
import { PostgrestClient } from '@supabase/postgrest-js';

import { supabaseKey, supabaseUrl } from './env';
import { accessToken } from './supabase';

// Every data request carries the user's access token, so RLS and my_role() see the staff
// member (never the publishable key alone).
const fetchWithAuth: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('apikey', supabaseKey);
  const token = await accessToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};

/** PostgREST: RPC calls (business writes go only through RPCs, CLAUDE.md rule 2). */
export const db = new PostgrestClient<Database>(`${supabaseUrl}/rest/v1`, {
  headers: { apikey: supabaseKey },
  fetch: fetchWithAuth,
});
