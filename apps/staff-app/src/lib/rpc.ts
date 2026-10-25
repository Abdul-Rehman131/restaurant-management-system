// The `rpc` namespace: loaded with the role screens, not with the shell (plan 4.10).
import enRpc from '../i18n/locales/en/rpc.json';

/**
 * RPC errors in plain language (plan 4.6 rule 4). Every function raises a stable code as the
 * error message (ADR 001): P0001 for business rules, 42501 for NOT_AUTHORIZED. Each code has
 * one message in the `rpc` namespace (locales/en/rpc.json); raw technical text never reaches staff. A Vitest
 * test checks that every code in supabase/migrations has a message.
 */
export type RpcErrorCode = keyof typeof enRpc;
export type RpcErrorKey = `rpc:${RpcErrorCode}`;

// The upper-case keys are the server's codes; `network` and `unknown` are the app's own.
const codes: ReadonlySet<string> = new Set(
  Object.keys(enRpc).filter((key) => /^[A-Z_]+$/.test(key)),
);

/** An RPC answer that is not what its Zod schema says (a contract break, never shown raw). */
export class RpcContractError extends Error {
  constructor(fn: string, cause: unknown) {
    super(`${fn}: the response does not match its schema`, { cause });
    this.name = 'RpcContractError';
  }
}

function messageOf(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('message' in error)) return null;
  const { message } = error as { message?: unknown };
  return typeof message === 'string' ? message : null;
}

/**
 * True when the request may not have reached the server (or its answer was lost): the
 * caller retries with the SAME request id, so a retry is a replay, never a second write.
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  const message = messageOf(error);
  // postgrest-js turns a failed fetch into { message: 'TypeError: Failed to fetch', code: '' }.
  return message !== null && /TypeError|Failed to fetch|NetworkError|Load failed/i.test(message);
}

/** The i18n key for an RPC failure: its stable code, else network, else unknown. */
export function rpcErrorKey(error: unknown): RpcErrorKey {
  const message = messageOf(error);
  if (message !== null && codes.has(message)) return `rpc:${message as RpcErrorCode}`;
  if (isNetworkError(error)) return 'rpc:network';
  return 'rpc:unknown';
}

/** The stable code of an RPC failure, or null (network, contract or unknown errors). */
export function rpcErrorCode(error: unknown): RpcErrorCode | null {
  const message = messageOf(error);
  return message !== null && codes.has(message) ? (message as RpcErrorCode) : null;
}
