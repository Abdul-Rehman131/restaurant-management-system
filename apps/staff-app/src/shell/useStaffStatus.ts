import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuth, type AppRole } from '../auth/auth-context';
import { db } from '../lib/db';

/**
 * Is this staff account still active? public.my_role() is the source of truth: it returns NULL
 * the moment an Admin deactivates the account (every role may call it). Checked on sign-in and
 * again whenever the screen regains focus; NULL signs the user out with "not active".
 */
export function useStaffStatus() {
  const { signOut } = useAuth();
  const { data } = useQuery({
    queryKey: ['my-role'],
    queryFn: async () => {
      const { data: role, error } = await db.rpc('my_role');
      if (error) throw error;
      // The generated type omits NULL, but my_role() returns NULL for inactive staff.
      return { role: role as AppRole | null };
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (data && data.role === null) void signOut('inactive');
  }, [data, signOut]);
}
