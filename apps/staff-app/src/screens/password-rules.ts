/**
 * The own-password rules (S6), the same as the `account` Edge Function checks
 * (supabase/functions/account): at least 10 characters, at most 72 bytes (bcrypt's limit),
 * not the current password, not containing the username. Pure, so they are unit-tested and
 * shown on the screen as a checklist; the server decides.
 */
export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_BYTES = 72;

export interface PasswordCheck {
  long: boolean;
  notTooLong: boolean;
  notCurrent: boolean;
  noUsername: boolean;
  matches: boolean;
}

export function checkPassword(input: {
  next: string;
  confirm: string;
  current: string;
  username: string;
}): PasswordCheck {
  const { next, confirm, current, username } = input;
  return {
    long: Array.from(next).length >= MIN_PASSWORD_LENGTH,
    notTooLong: new TextEncoder().encode(next).length <= MAX_PASSWORD_BYTES,
    notCurrent: next === '' || next !== current,
    noUsername: username === '' || !next.toLowerCase().includes(username.toLowerCase()),
    matches: next !== '' && next === confirm,
  };
}

export function passwordOk(check: PasswordCheck): boolean {
  return Object.values(check).every(Boolean);
}

/** The username of a staff login email (<username>@staff.invalid). */
export function usernameOf(email: string | undefined): string {
  return email?.split('@')[0] ?? '';
}
