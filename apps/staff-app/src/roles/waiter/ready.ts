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
 * Kitchen batches that are Ready and have not rung yet. `known` holds every batch already
 * Ready when this session first saw the orders, plus every batch that already rang.
 *   * Opening the app never replays old alerts: they are in the first snapshot.
 *   * A batch is caught even when this screen never saw it Sent or Preparing (a fast kitchen,
 *     or a reload that skipped a state): seen in the S3 check, where a waiter missed the alert
 *     because the rule needed the earlier status.
 *   * A drinks-only batch (Ready at once, no kitchen lines, BR-07) never rings.
 */
export function newlyReady(
  known: ReadonlySet<string>,
  orders: readonly MyOrder[],
  now: number,
): ReadyAlert[] {
  const alerts: ReadyAlert[] = [];
  for (const order of orders) {
    for (const batch of order.order_batches) {
      const fromKitchen = batch.order_items.some((line) => line.needs_kitchen);
      if (batch.status === 'ready' && fromKitchen && !known.has(batch.id)) {
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

/** The first snapshot of a session: every batch that is already Ready. */
export function readyBatches(orders: readonly MyOrder[]): Set<string> {
  return new Set(
    orders.flatMap((o) => o.order_batches.filter((b) => b.status === 'ready').map((b) => b.id)),
  );
}
