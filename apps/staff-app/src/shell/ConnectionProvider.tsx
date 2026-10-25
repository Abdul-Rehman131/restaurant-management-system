import { useOnlineStatus } from '@rms/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { ConnectionContext, type ConnectionValue } from './connection-context';

/** Private channel every active staff member may join (migration realtime_heartbeat). */
const HEARTBEAT_TOPIC = 'staff:heartbeat';
/** A lost channel shows "Reconnecting" first; after this long it counts as offline. */
const OFFLINE_AFTER_MS = 5_000;

type Channel = 'connecting' | 'joined' | 'lost';

/**
 * The connection state of the signed-in screens: the browser's network state plus the
 * Realtime heartbeat channel. Realtime loads after the shell has rendered. When the channel
 * comes back after a drop, every query refetches (plan 4.6 rule 7).
 */
export function ConnectionProvider({ children }: { children: ReactNode }) {
  const online = useOnlineStatus();
  const queryClient = useQueryClient();
  const [channel, setChannel] = useState<Channel>('connecting');
  const [lostTooLong, setLostTooLong] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let wasJoined = false;
    let leave: (() => void) | undefined;

    void import('../lib/realtime').then(async ({ realtime }) => {
      if (cancelled) return;
      await realtime.setAuth();
      const heartbeat = realtime.channel(HEARTBEAT_TOPIC, { config: { private: true } });
      heartbeat.subscribe((status) => {
        // Compared as text: importing the enum would load Realtime with the shell.
        if ((status as string) === 'SUBSCRIBED') {
          if (wasJoined) void queryClient.invalidateQueries();
          wasJoined = true;
          setLostTooLong(false);
          setChannel('joined');
        } else {
          // CHANNEL_ERROR, TIMED_OUT, CLOSED: realtime-js keeps retrying the join.
          setChannel(wasJoined ? 'lost' : 'connecting');
        }
      });
      leave = () => {
        void realtime.removeChannel(heartbeat);
      };
    });

    return () => {
      cancelled = true;
      leave?.();
    };
  }, [queryClient]);

  // "Reconnecting" for a short drop; offline (banner, actions disabled) if it lasts.
  useEffect(() => {
    if (channel === 'joined') return;
    const timer = window.setTimeout(() => {
      setLostTooLong(true);
    }, OFFLINE_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [channel]);

  const value = useMemo<ConnectionValue>(() => {
    if (!online || lostTooLong) return { state: 'offline', canSend: false };
    if (channel !== 'joined') return { state: 'connecting', canSend: false };
    return { state: 'online', canSend: true };
  }, [online, lostTooLong, channel]);

  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}
