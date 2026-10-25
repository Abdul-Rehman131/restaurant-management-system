/**
 * Username login (Q3). Staff type a username; Supabase Auth needs an email, so the app signs in
 * with an internal address derived from it. MUST match the SQL function
 * `public.staff_login_email()` (supabase/migrations/*_auth_helpers.sql).
 *
 * `.invalid` is a reserved domain (RFC 2606): these addresses can never receive mail.
 */
export const STAFF_LOGIN_EMAIL_DOMAIN = 'staff.invalid';

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Normalised username, or null if it can never be a valid staff username. */
export function normalizeUsername(username: string): string | null {
  const normalized = username.trim().toLowerCase();
  return USERNAME_PATTERN.test(normalized) ? normalized : null;
}

/** 'Waiter1 ' -> 'waiter1@staff.invalid'. Returns null for an invalid username. */
export function staffLoginEmail(username: string): string | null {
  const normalized = normalizeUsername(username);
  return normalized ? `${normalized}@${STAFF_LOGIN_EMAIL_DOMAIN}` : null;
}
