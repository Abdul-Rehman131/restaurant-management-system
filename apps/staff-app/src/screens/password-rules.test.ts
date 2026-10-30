import { describe, expect, it } from 'vitest';

import { checkPassword, passwordOk, usernameOf } from './password-rules';

const base = { current: 'old-secret-1', username: 'sara', confirm: '' };

describe('own password rules', () => {
  it('accepts a long password that matches its confirmation', () => {
    const check = checkPassword({ ...base, next: 'river-lamp-42', confirm: 'river-lamp-42' });
    expect(check).toEqual({
      long: true,
      notTooLong: true,
      notCurrent: true,
      noUsername: true,
      matches: true,
    });
    expect(passwordOk(check)).toBe(true);
  });

  it('needs 10 characters, counted as characters', () => {
    expect(checkPassword({ ...base, next: 'short-123', confirm: 'short-123' }).long).toBe(false);
    expect(checkPassword({ ...base, next: 'ééééééééééé', confirm: '' }).long).toBe(true);
  });

  it('allows at most 72 bytes', () => {
    expect(checkPassword({ ...base, next: 'a'.repeat(72), confirm: '' }).notTooLong).toBe(true);
    expect(checkPassword({ ...base, next: 'a'.repeat(73), confirm: '' }).notTooLong).toBe(false);
    expect(checkPassword({ ...base, next: 'é'.repeat(37), confirm: '' }).notTooLong).toBe(false);
  });

  it('refuses the current password and the username, any case', () => {
    expect(
      checkPassword({ ...base, next: 'old-secret-1', confirm: 'old-secret-1' }).notCurrent,
    ).toBe(false);
    expect(checkPassword({ ...base, next: 'Sara-2026-new', confirm: '' }).noUsername).toBe(false);
  });

  it('the confirmation must match', () => {
    expect(
      checkPassword({ ...base, next: 'river-lamp-42', confirm: 'river-lamp-43' }).matches,
    ).toBe(false);
    expect(passwordOk(checkPassword({ ...base, next: '', confirm: '' }))).toBe(false);
  });

  it('takes the username from the login email', () => {
    expect(usernameOf('waiter1@staff.invalid')).toBe('waiter1');
    expect(usernameOf(undefined)).toBe('');
  });
});
