import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';

/** A private topic and, per event, the query it invalidates. */
export type LiveTopics = readonly (readonly [topic: string, events: Record<string, QueryKey>])[];

/**
 * Live updates for a role screen (M8, plan 4.6 rule 7). The database broadcasts ids only on
 * private topics (migration s1_realtime_broadcasts); an event just invalidates the query it
 * touches, and the screen refetches through its normal, permission-checked reads. Whenever a
 * channel joins (first time or again after a drop), everything under `refetchAll` refetches,
 * so a missed event loses nothing. Realtime loads after the shell (dynamic import, plan 4.10).
 * `topics` must be stable (a module constant or memoised).
 */
export function useLiveTopics(topics: LiveTopics | null, refetchAll: QueryKey): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!topics) return;
    let cancelled = false;
    let leave: (() => void) | undefined;

    void import('./realtime').then(async ({ realtime }) => {
      await realtime.setAuth();
      if (cancelled) return;
      const channels = topics.map(([topic, events]) => {
        const channel = realtime.channel(topic, { config: { private: true } });
        for (const [event, queryKey] of Object.entries(events)) {
          channel.on('broadcast', { event }, () => {
            void queryClient.invalidateQueries({ queryKey });
          });
        }
        channel.subscribe((status) => {
          // Compared as text, like the heartbeat (no Realtime enum import). Every join
          // refetches, the first one too: a change between the screen's first read and the
          // join is never broadcast to it (seen in the S4 check: a bill request was missed).
          if ((status as string) === 'SUBSCRIBED') {
            void queryClient.invalidateQueries({ queryKey: refetchAll });
          }
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
  }, [topics, refetchAll, queryClient]);
}
