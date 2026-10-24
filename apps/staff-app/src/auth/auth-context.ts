import type { Enums } from '@rms/shared';
import type { Session } from '@supabase/auth-js';
import { createContext, useContext } from 'react';

import { paths } from '../paths';

export type AppRole = Enums<'app_role'>;

/** Why the last session ended, for a plain-language message on the login screen. */
export type EndReason = 'expired' | 'inactive';

export interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: Session | null;
  /**
   * From the JWT `app_role` claim: for UI ROUTING ONLY. The database decides every permission
   * with my_role() on each request, so a stale or edited claim can never grant access.
   */
  role: AppRole | null;
  /** Assurance level of this session: aal2 after the MFA code step. */
  aal: 'aal1' | 'aal2' | null;
  /** The user has a verified TOTP factor, so aal2 is required (Admin). */
  hasVerifiedFactor: boolean;
  endReason: EndReason | null;
  /** Signs out on this device. With a reason, the login screen explains it. */
  signOut: (reason?: EndReason) => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

/** Where each role lands after sign-in. Rider screens are P3. */
export const roleHome: Record<AppRole, string> = {
  admin: paths.admin,
  cashier: paths.cashier,
  waiter: paths.waiter,
  chef: paths.kitchen,
  rider: paths.notAvailable,
};

const MFA_SKIP_KEY = 'mfa-setup-skipped';

/** Admin chose "Skip for now" on the MFA set-up screen (this tab only; enforcement is P1). */
export function mfaSetupSkipped(): boolean {
  try {
    return sessionStorage.getItem(MFA_SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

export function skipMfaSetup(): void {
  try {
    sessionStorage.setItem(MFA_SKIP_KEY, '1');
  } catch {
    // Storage blocked: the prompt simply shows again next time.
  }
}

/** Admin must finish the MFA step (or set-up prompt) before any screen. */
export function needsMfaStep(auth: AuthState): boolean {
  if (auth.role !== 'admin') return false;
  if (auth.hasVerifiedFactor) return auth.aal !== 'aal2';
  return !mfaSetupSkipped();
}
