import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { useAuth } from '../auth/auth-context';
import { db } from '../lib/db';
import { accountKey } from './account-key';

export { accountKey };

export interface Account {
  active: boolean;
  role: string | null;
  /** An Admin must pass the second sign-in step first (only while admin_mfa is on). */
  mfa_step: boolean;
  /** Whether Admins need the second step (settings.require_admin_mfa; off only for a demo). */
  admin_mfa: boolean;
  /** A temporary password must be changed first (S6): every API call is refused until then. */
  password_change: boolean;
}

/**
 * Is this staff account still active, and is a password change pending? public.my_account()
 * is the source of truth (my_role() itself is NULL until the person may work, S6). Checked on
 * sign-in and again whenever the screen regains focus; inactive signs the user out with "not
 * active". `settled` is true once the first answer (or a failure, e.g. offline) is in.
 */
export function useStaffStatus(): { account: Account | undefined; settled: boolean } {
  const { signOut } = useAuth();
  const { data, isPending, isError } = useQuery({
    queryKey: accountKey,
    queryFn: async () => {
      const { data: account, error } = await db.rpc('my_account');
      if (error) throw error;
      return account as unknown as Account;
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (data && !data.active) void signOut('inactive');
  }, [data, signOut]);

  return { account: data, settled: !isPending || isError };
}
