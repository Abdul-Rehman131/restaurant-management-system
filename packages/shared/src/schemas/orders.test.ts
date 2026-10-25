import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';

import { addItemsToOrderResponse, createOrderResponse, recordPaymentResponse } from './orders';

// Shapes as returned by the database (keys pinned by supabase/tests/990_rpc_contracts.test.sql).
const orderSummaryFixture = {
  order_id: '2b7f1d5e-8a0c-4c47-9a53-3f0f3c1b9e21',
  order_number: 'ORD-20261025-001',
  business_date: '2026-10-25',
  type: 'dine_in',
  status: 'accepted',
  payment_status: 'unpaid',
  table_id: '00000000-0000-0000-0000-000000000101',
  waiter_id: null,
  bill_requested: false,
  subtotal: 150000,
  discount: 0,
  service_charge: 7500,
  tax: 24000,
  total: 181500,
  replayed: false,
};

describe('create_order response', () => {
  it('accepts the order summary', () => {
    expect(z.parse(createOrderResponse, orderSummaryFixture).total).toBe(181500);
  });

  it('accepts a Take Away order without table or waiter', () => {
    const takeAway = { ...orderSummaryFixture, type: 'take_away', table_id: null };
    expect(z.parse(createOrderResponse, takeAway).table_id).toBeNull();
  });

  it('rejects money that is not a non-negative integer', () => {
    expect(() => z.parse(createOrderResponse, { ...orderSummaryFixture, total: 1815.5 })).toThrow();
    expect(() => z.parse(createOrderResponse, { ...orderSummaryFixture, tax: -1 })).toThrow();
    expect(() =>
      z.parse(createOrderResponse, { ...orderSummaryFixture, total: '181500' }),
    ).toThrow();
  });

  it('rejects an unknown status or a missing key', () => {
    expect(() =>
      z.parse(createOrderResponse, { ...orderSummaryFixture, status: 'done' }),
    ).toThrow();
    const withoutReplayed: Partial<typeof orderSummaryFixture> = { ...orderSummaryFixture };
    delete withoutReplayed.replayed;
    expect(() => z.parse(createOrderResponse, withoutReplayed)).toThrow();
  });
});

describe('add_items_to_order response', () => {
  it('accepts the summary with the add-on batch number', () => {
    const r = z.parse(addItemsToOrderResponse, { ...orderSummaryFixture, batch_no: 2 });
    expect(r.batch_no).toBe(2);
  });

  it('rejects batch 1 (an add-on is always batch 2 or more)', () => {
    expect(() =>
      z.parse(addItemsToOrderResponse, { ...orderSummaryFixture, batch_no: 1 }),
    ).toThrow();
  });
});

describe('record_payment response', () => {
  const payment = {
    order_id: orderSummaryFixture.order_id,
    order_number: orderSummaryFixture.order_number,
    status: 'completed',
    payment_status: 'paid',
    total: 181500,
    paid: 181500,
    change_due: 18500,
    table_status: 'available',
    replayed: false,
  };

  it('accepts a completed payment', () => {
    expect(z.parse(recordPaymentResponse, payment).change_due).toBe(18500);
  });

  it('accepts a Take Away payment (no table)', () => {
    expect(
      z.parse(recordPaymentResponse, { ...payment, table_status: null }).table_status,
    ).toBeNull();
  });
});
