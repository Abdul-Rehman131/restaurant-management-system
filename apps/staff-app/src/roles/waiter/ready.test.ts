import { describe, expect, it } from 'vitest';

import type { MyOrder, OrderBatch } from './data';
import { newlyReady, readyBatches } from './ready';

const batch = (id: string, batchNo: number, status: OrderBatch['status']): OrderBatch => ({
  id,
  batch_no: batchNo,
  status,
  sent_at: null,
  ready_at: null,
  served_at: null,
  order_items: [],
});

const order = (batches: OrderBatch[]): MyOrder => ({
  id: 'order-1',
  order_number: 'ORD-20261025-001',
  status: 'accepted',
  payment_status: 'unpaid',
  bill_requested: false,
  table_id: 'table-7',
  created_at: '2026-10-25T10:00:00Z',
  subtotal: 0,
  discount: 0,
  service_charge: 0,
  tax: 0,
  total: 0,
  order_batches: batches,
});

const kitchenLine = {
  id: 'l1',
  name_snapshot: 'Tikka',
  quantity: 1,
  notes: null,
  line_total: 0,
  needs_kitchen: true,
  is_cancelled: false,
};
const drinkLine = { ...kitchenLine, id: 'l2', name_snapshot: 'Water', needs_kitchen: false };
const kitchenBatch = (id: string, batchNo: number, status: OrderBatch['status']) => ({
  ...batch(id, batchNo, status),
  order_items: [kitchenLine],
});

describe('Ready alerts', () => {
  it('rings once when a kitchen batch turns Ready', () => {
    const known = readyBatches([order([kitchenBatch('b1', 1, 'preparing')])]);
    const now = [order([kitchenBatch('b1', 1, 'ready')])];
    expect(newlyReady(known, now, 1)).toEqual([
      { id: 'b1', orderId: 'order-1', tableId: 'table-7', batchNo: 1, at: 1, read: false },
    ]);
    expect(newlyReady(new Set([...known, 'b1']), now, 2)).toEqual([]);
  });

  it('never replays batches that were already Ready when the app opened', () => {
    const first = [order([kitchenBatch('b1', 1, 'ready')])];
    expect(newlyReady(readyBatches(first), first, 1)).toEqual([]);
  });

  it('rings for an ADD-ON this screen never saw before it was Ready (fast kitchen)', () => {
    const known = readyBatches([order([kitchenBatch('b1', 1, 'served')])]);
    const now = [order([kitchenBatch('b1', 1, 'served'), kitchenBatch('b2', 2, 'ready')])];
    expect(newlyReady(known, now, 1).map((a) => a.batchNo)).toEqual([2]);
  });

  it('a drinks-only add-on that is Ready at once never rings (BR-07)', () => {
    const known = readyBatches([order([kitchenBatch('b1', 1, 'served')])]);
    const drinks = { ...batch('b2', 2, 'ready'), order_items: [drinkLine] };
    expect(newlyReady(known, [order([kitchenBatch('b1', 1, 'served'), drinks])], 1)).toEqual([]);
  });
});
