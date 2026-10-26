import { isAuthError } from '@supabase/auth-js';

/** Login failures, each mapped to one plain-language message (common.json login.errors.*). */
export type LoginError =
  'invalidCredentials' | 'inactive' | 'tooManyAttempts' | 'network' | 'unknown';

export function loginErrorFrom(error: unknown): LoginError {
  if (!isAuthError(error)) return 'network';
  // 403 from the token endpoint comes only from our access-token hook: the staff account is
  // not active (migration access_token_hook).
  if (error.status === 403) return 'inactive';
  // A deactivated login is also banned (staff-admin, S5): Auth refuses it before the hook.
  if (error.code === 'user_banned') return 'inactive';
  if (error.code === 'invalid_credentials' || error.status === 400) return 'invalidCredentials';
  if (error.status === 429) return 'tooManyAttempts';
  if (error.name === 'AuthRetryableFetchError' || !error.status) return 'network';
  return 'unknown';
}

/** The RPC refused the caller (inactive or wrong role): see private.require_role. */
export function isNotAuthorized(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === '42501'
  );
}
