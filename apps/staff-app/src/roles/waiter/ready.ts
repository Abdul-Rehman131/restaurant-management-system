import type { MyOrder } from './data';

/** Ready detection (pure, unit-tested in ready.test.ts). */
export interface ReadyAlert {
  /** The batch id: one alert per batch. */
  id: string;
  orderId: string;
  tableId: string | null;
  batchNo: number;
  at: number;
  read: boolean;
}

/**
 * Batches that turned Ready since the last look. A batch counts only when it was seen before
 * in another status, so opening the app never replays old alerts, and a drinks-only add-on
 * (Ready at once, BR-07) never rings.
 */
export function newlyReady(
  previous: ReadonlyMap<string, string>,
  orders: readonly MyOrder[],
  now: number,
): ReadyAlert[] {
  const alerts: ReadyAlert[] = [];
  for (const order of orders) {
    for (const batch of order.order_batches) {
      const before = previous.get(batch.id);
      if (batch.status === 'ready' && before !== undefined && before !== 'ready') {
        alerts.push({
          id: batch.id,
          orderId: order.id,
          tableId: order.table_id,
          batchNo: batch.batch_no,
          at: now,
          read: false,
        });
      }
    }
  }
  return alerts;
}

export function batchStatuses(orders: readonly MyOrder[]): Map<string, string> {
  return new Map(orders.flatMap((o) => o.order_batches.map((b) => [b.id, b.status] as const)));
}
