import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { waiterKeys } from './data';

/**
 * Live updates for the waiter (M8, plan 4.6 rule 7). The database broadcasts ids only on
 * private topics (migration s1_realtime_broadcasts); an event just invalidates the queries it
 * touches, and the screen refetches through its normal, RLS-checked reads:
 *   staff:waiter:<my id>  order_changed, batch_changed   my orders (Ready alert)
 *   staff:tables          table_changed                  the table grid
 *   staff:menu            menu_changed                   the menu (Sold Out, BR-13)
 * When a channel joins again after a drop, everything visible refetches, so a missed event
 * loses nothing. Realtime loads after the shell (dynamic import, plan 4.10).
 */
export function useWaiterLive(userId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let leave: (() => void) | undefined;

    void import('../../lib/realtime').then(async ({ realtime }) => {
      await realtime.setAuth();
      if (cancelled) return;
      const invalidate = (queryKey: readonly string[]) => () => {
        void queryClient.invalidateQueries({ queryKey });
      };
      const topics: [string, Record<string, readonly string[]>][] = [
        [
          `staff:waiter:${userId}`,
          { order_changed: waiterKeys.myOrders, batch_changed: waiterKeys.myOrders },
        ],
        ['staff:tables', { table_changed: waiterKeys.tables }],
        ['staff:menu', { menu_changed: waiterKeys.menu }],
      ];
      const channels = topics.map(([topic, events]) => {
        const channel = realtime.channel(topic, { config: { private: true } });
        for (const [event, queryKey] of Object.entries(events)) {
          channel.on('broadcast', { event }, invalidate(queryKey));
        }
        let joined = false;
        channel.subscribe((status) => {
          // Compared as text, like the heartbeat (no Realtime enum import).
          if ((status as string) !== 'SUBSCRIBED') return;
          if (joined) void queryClient.invalidateQueries({ queryKey: waiterKeys.all });
          joined = true;
        });
        return channel;
      });
      leave = () => {
        for (const channel of channels) void realtime.removeChannel(channel);
      };
    });

    return () => {
      cancelled = true;
      leave?.();
    };
  }, [userId, queryClient]);
}
