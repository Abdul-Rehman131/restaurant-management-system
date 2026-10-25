import { describe, expect, it } from 'vitest';

import type { MyOrder, OrderBatch } from './data';
import { batchStatuses, newlyReady } from './ready';

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

describe('Ready alerts', () => {
  it('alerts once when a batch turns Ready', () => {
    const before = batchStatuses([order([batch('b1', 1, 'preparing')])]);
    const now = [order([batch('b1', 1, 'ready')])];
    expect(newlyReady(before, now, 1)).toEqual([
      { id: 'b1', orderId: 'order-1', tableId: 'table-7', batchNo: 1, at: 1, read: false },
    ]);
    expect(newlyReady(batchStatuses(now), now, 2)).toEqual([]);
  });

  it('never replays old Ready batches when the app opens', () => {
    expect(newlyReady(new Map(), [order([batch('b1', 1, 'ready')])], 1)).toEqual([]);
  });

  it('a drinks-only add-on that is Ready at once does not ring (BR-07)', () => {
    const before = batchStatuses([order([batch('b1', 1, 'served')])]);
    const now = [order([batch('b1', 1, 'served'), batch('b2', 2, 'ready')])];
    expect(newlyReady(before, now, 1)).toEqual([]);
  });

  it('an ADD-ON that the kitchen finishes rings with its batch number', () => {
    const before = batchStatuses([order([batch('b1', 1, 'served'), batch('b2', 2, 'sent')])]);
    const now = [order([batch('b1', 1, 'served'), batch('b2', 2, 'ready')])];
    expect(newlyReady(before, now, 1).map((a) => a.batchNo)).toEqual([2]);
  });
});
