import { RealtimeClient } from '@supabase/realtime-js';

import { supabaseKey, supabaseUrl } from './env';
import { accessToken, auth } from './supabase';

// Loaded after the signed-in shell has rendered (dynamic import), so Realtime never delays
// the first screen (plan 4.10).

/** Realtime: private broadcast channels, authorised per topic with my_role() in the database. */
export const realtime = new RealtimeClient(`${supabaseUrl}/realtime/v1`, {
  params: { apikey: supabaseKey },
  accessToken,
});

// Give Realtime the new token after every refresh, so private channels stay authorised.
auth.onAuthStateChange((event) => {
  if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') void realtime.setAuth();
  if (event === 'SIGNED_OUT') void realtime.disconnect();
});
