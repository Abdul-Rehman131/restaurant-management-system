import type { ConnectionState } from '@rms/ui';
import { createContext, useContext } from 'react';

export interface ConnectionValue {
  /** What ConnectionDot shows: live, reconnecting or offline. */
  state: ConnectionState;
  /**
   * Primary actions (Send to Kitchen, Pay, ...) are allowed only while connected, so nothing is
   * half-sent (spec 7.5, plan 4.6 rule 8).
   */
  canSend: boolean;
}

export const ConnectionContext = createContext<ConnectionValue>({
  state: 'connecting',
  canSend: false,
});

export function useConnection(): ConnectionValue {
  return useContext(ConnectionContext);
}
