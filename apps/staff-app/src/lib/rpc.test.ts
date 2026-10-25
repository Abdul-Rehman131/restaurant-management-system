import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import enRpc from '../i18n/locales/en/rpc.json';
import { isNetworkError, rpcErrorCode, rpcErrorKey } from './rpc';

const migrations = join(import.meta.dirname, '../../../../supabase/migrations');

/** Every stable error code the database can raise: the upper-case literals of the migrations. */
function migrationCodes(): string[] {
  const codes = new Set<string>();
  for (const file of readdirSync(migrations).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(migrations, file), 'utf8');
    for (const match of sql.matchAll(/'([A-Z]+(?:_[A-Z]+)+)'/g)) codes.add(match[1] ?? '');
  }
  return [...codes].sort();
}

describe('RPC error messages', () => {
  it('every error code in the migrations has a plain-language message', () => {
    const codes = migrationCodes();
    expect(codes.length).toBeGreaterThan(50);
    const missing = codes.filter((code) => !Object.hasOwn(enRpc, code));
    expect(missing).toEqual([]);
  });

  it('messages are plain words, not codes', () => {
    for (const [code, message] of Object.entries(enRpc)) {
      expect(message, code).not.toMatch(/[A-Z]{2,}_[A-Z]/);
      expect(message.length, code).toBeGreaterThan(10);
    }
  });

  it('maps a business error (P0001) to its message', () => {
    const error = { code: 'P0001', message: 'TABLE_HAS_OPEN_ORDER', details: null, hint: null };
    expect(rpcErrorKey(error)).toBe('rpc:TABLE_HAS_OPEN_ORDER');
    expect(rpcErrorCode(error)).toBe('TABLE_HAS_OPEN_ORDER');
    expect(rpcErrorKey({ code: 'P0001', message: 'ITEM_UNAVAILABLE' })).toBe(
      'rpc:ITEM_UNAVAILABLE',
    );
  });

  it('maps NOT_AUTHORIZED (42501) to its message', () => {
    expect(rpcErrorKey({ code: '42501', message: 'NOT_AUTHORIZED' })).toBe('rpc:NOT_AUTHORIZED');
  });

  it('a failed fetch is a network error (retry with the same request id)', () => {
    const error = { code: '', message: 'TypeError: Failed to fetch', details: '', hint: '' };
    expect(isNetworkError(error)).toBe(true);
    expect(rpcErrorKey(error)).toBe('rpc:network');
    expect(rpcErrorCode(error)).toBeNull();
    expect(rpcErrorKey(new TypeError('Load failed'))).toBe('rpc:network');
  });

  it('anything else is unknown: raw technical text never reaches staff', () => {
    expect(rpcErrorKey({ code: '23505', message: 'duplicate key value violates…' })).toBe(
      'rpc:unknown',
    );
    expect(rpcErrorKey(new Error('boom'))).toBe('rpc:unknown');
    expect(rpcErrorKey(null)).toBe('rpc:unknown');
    expect(rpcErrorCode({ message: 'network' })).toBeNull();
  });
});
