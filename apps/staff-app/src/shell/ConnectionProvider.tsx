import { useOnlineStatus } from '@rms/ui';
import { useMemo, type ReactNode } from 'react';

import { ConnectionContext, type ConnectionValue } from './connection-context';

/** The device's connection state for the signed-in screens. */
export function ConnectionProvider({ children }: { children: ReactNode }) {
  const online = useOnlineStatus();
  const value = useMemo<ConnectionValue>(
    () => ({ state: online ? 'online' : 'offline', canSend: online }),
    [online],
  );
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}
