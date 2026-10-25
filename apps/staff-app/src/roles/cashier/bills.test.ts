import { describe, expect, it } from 'vitest';

import { newBillRequests, requestedBills, sortBills, type Bill } from './bills';

const bill = (over: Partial<Bill>): Bill => ({
  order_id: 'o',
  order_number: 'ORD-20261026-001',
  type: 'dine_in',
  status: 'accepted',
  payment_status: 'unpaid',
  table_id: 't',
  table_number: 1,
  waiter_id: null,
  waiter_name: null,
  customer_name: null,
  customer_phone: null,
  bill_requested: false,
  bill_requested_at: null,
  created_at: '2026-10-26T10:00:00Z',
  subtotal: 0,
  discount: 0,
  service_charge: 0,
  tax: 0,
  total: 0,
  paid: 0,
  due: 0,
  ...over,
});

describe('open bills order', () => {
  it('Bill Requested first (oldest request first), then Ready Take Away, then by age', () => {
    const bills = [
      bill({ order_id: 'old', created_at: '2026-10-26T09:00:00Z' }),
      bill({
        order_id: 'ta-ready',
        type: 'take_away',
        status: 'ready',
        table_id: null,
        created_at: '2026-10-26T11:00:00Z',
      }),
      bill({
        order_id: 'req-late',
        bill_requested: true,
        bill_requested_at: '2026-10-26T11:30:00Z',
        created_at: '2026-10-26T08:00:00Z',
      }),
      bill({
        order_id: 'ta-preparing',
        type: 'take_away',
        status: 'preparing',
        table_id: null,
        created_at: '2026-10-26T08:30:00Z',
      }),
      bill({
        order_id: 'req-early',
        bill_requested: true,
        bill_requested_at: '2026-10-26T11:10:00Z',
        created_at: '2026-10-26T10:30:00Z',
      }),
    ];
    expect(sortBills(bills).map((b) => b.order_id)).toEqual([
      'req-early',
      'req-late',
      'ta-ready',
      'ta-preparing',
      'old',
    ]);
  });
});

describe('bill requests', () => {
  it('new requests only: never the ones already requested at the first look', () => {
    const first = [bill({ order_id: 'a', bill_requested: true }), bill({ order_id: 'b' })];
    const known = requestedBills(first);
    expect(newBillRequests(known, first)).toEqual([]);
    const later = [
      bill({ order_id: 'a', bill_requested: true }),
      bill({ order_id: 'b', bill_requested: true }),
    ];
    expect(newBillRequests(known, later)).toEqual(['b']);
  });
});
