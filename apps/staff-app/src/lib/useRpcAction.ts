import { useCallback, useRef, useState } from 'react';

import { newRequestId } from './request-id';
import { rpcErrorKey, type RpcErrorKey } from './rpc';

export interface RpcAction<A extends unknown[]> {
  run: (...args: A) => Promise<boolean>;
  pending: boolean;
  /** The i18n key of the last failure, until the next attempt. */
  error: RpcErrorKey | null;
  clearError: () => void;
}

/**
 * One server action (Mark Served, Request Bill, ...), following plan 4.6 rules 1 and 2:
 *   * pending at once (the button shows it in the same frame), and a second tap while sending
 *     is ignored, so nothing is sent twice;
 *   * a request id is made when the action starts and reused on every retry until the server
 *     confirms, so a lost answer plus a retry is a replay (BR-15);
 *   * the screen changes only after the server answers (hard rule 9): `onDone` refetches.
 */
export function useRpcAction<A extends unknown[], R>(
  call: (requestId: string, ...args: A) => Promise<R>,
  onDone: (result: R) => unknown,
): RpcAction<A> {
  const requestId = useRef<string | null>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<RpcErrorKey | null>(null);

  const run = useCallback(
    async (...args: A) => {
      if (busy.current) return false;
      busy.current = true;
      setPending(true);
      setError(null);
      requestId.current ??= newRequestId();
      try {
        const result = await call(requestId.current, ...args);
        requestId.current = null;
        await onDone(result);
        return true;
      } catch (err) {
        setError(rpcErrorKey(err));
        return false;
      } finally {
        busy.current = false;
        setPending(false);
      }
    },
    [call, onDone],
  );

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return { run, pending, error, clearError };
}
