import type { Session } from '@supabase/auth-js';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { queryClient } from '../lib/queryClient';
import { auth as supabaseAuth } from '../lib/supabase';
import { AuthContext, type AuthState, type EndReason } from './auth-context';
import { readClaims } from './claims';

/**
 * Session state from Supabase Auth. A session that disappears without the user signing out
 * (refresh token expired or revoked, signed out elsewhere) is reported as "expired".
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthState['status']>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [endReason, setEndReason] = useState<EndReason | null>(null);
  const signingOut = useRef(false);
  const wasSignedIn = useRef(false);

  useEffect(() => {
    // Fires INITIAL_SESSION first, then every sign-in, refresh and sign-out (also other tabs).
    const { data } = supabaseAuth.onAuthStateChange((_event, next) => {
      if (next) {
        wasSignedIn.current = true;
        setSession(next);
        setStatus('signedIn');
        return;
      }
      if (wasSignedIn.current && !signingOut.current) {
        setEndReason((current) => current ?? 'expired');
      }
      wasSignedIn.current = false;
      signingOut.current = false;
      setSession(null);
      setStatus('signedOut');
      queryClient.clear();
    });
    return () => {
      data.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback(async (reason?: EndReason) => {
    signingOut.current = true;
    setEndReason(reason ?? null);
    await supabaseAuth.signOut({ scope: 'local' });
  }, []);

  const value = useMemo<AuthState>(() => {
    const claims = session ? readClaims(session.access_token) : { role: null, aal: null };
    const hasVerifiedFactor =
      session?.user.factors?.some((factor) => factor.status === 'verified') ?? false;
    return { status, session, ...claims, hasVerifiedFactor, endReason, signOut };
  }, [status, session, endReason, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
