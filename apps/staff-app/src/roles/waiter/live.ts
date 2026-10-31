import { useMemo } from 'react';

import { useLiveTopics, type LiveTopics } from '../../lib/live';
import { menuKey } from '../../ordering/menu';
import { waiterKeys } from './data';

/**
 * The waiter's live topics (useLiveTopics):
 *   staff:waiter:<my id>  order_changed, batch_changed   my orders (Ready alert)
 *   staff:tables          table_changed                  the table grid
 *   staff:menu            menu_changed                   the menu (Sold Out, BR-13)
 */
export function useWaiterLive(userId: string | undefined): void {
  const topics = useMemo<LiveTopics | null>(
    () =>
      userId
        ? [
            [
              `staff:waiter:${userId}`,
              { order_changed: waiterKeys.myOrders, batch_changed: waiterKeys.myOrders },
            ],
            ['staff:tables', { table_changed: waiterKeys.tables }],
            ['staff:menu', { menu_changed: menuKey }],
          ]
        : null,
    [userId],
  );
  useLiveTopics(topics, waiterKeys.all);
}
