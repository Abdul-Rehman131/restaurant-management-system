import { describe, expect, it } from 'vitest';

import { buildReceipt, type ReceiptOrder, type ReceiptPayment } from './receipt';

const settings = {
  restaurantName: 'Ember Kitchen (Demo)',
  address: '1 Demo Street',
  phone: '000 0000000',
  receiptFooter: 'Thank you!',
  timezone: 'Asia/Karachi',
};

const order: ReceiptOrder = {
  order_number: 'ORD-20261026-007',
  created_at: '2026-10-26T15:00:00Z',
  table_number: 7,
  customer_name: null,
  subtotal: 85000,
  discount: 0,
  service_charge: 4250,
  tax: 13600,
  total: 102850,
  lines: [
    { name: 'Seekh Kebab (4 pcs)', quantity: 1, line_total: 70000, is_cancelled: false },
    { name: 'Soft Drink (Can)', quantity: 1, line_total: 15000, is_cancelled: false },
    { name: 'Raita', quantity: 2, line_total: 30000, is_cancelled: true },
  ],
};

const cash: ReceiptPayment = {
  method: 'cash',
  amount: 102850,
  tendered: 150000,
  reference: null,
  received_at: '2026-10-26T16:05:00Z',
  voided_at: null,
};

describe('receipt', () => {
  it('has the restaurant, the order, the live lines and the server totals', () => {
    const receipt = buildReceipt(order, [cash], settings, 'en');
    expect(receipt.restaurantName).toBe('Ember Kitchen (Demo)');
    expect(receipt.address).toBe('1 Demo Street');
    expect(receipt.orderNumber).toBe('ORD-20261026-007');
    expect(receipt.servedTo).toEqual({ kind: 'table', table: 7 });
    expect(receipt.lines).toEqual([
      { name: 'Seekh Kebab (4 pcs)', quantity: 1, amount: 70000 },
      { name: 'Soft Drink (Can)', quantity: 1, amount: 15000 },
    ]);
    expect(receipt.totals).toEqual([
      { key: 'subtotal', amount: 85000 },
      { key: 'serviceCharge', amount: 4250 },
      { key: 'tax', amount: 13600 },
      { key: 'total', amount: 102850 },
    ]);
    expect(receipt.footer).toBe('Thank you!');
  });

  it('uses the restaurant time zone, not the device: 16:05 UTC is 21:05 in Karachi', () => {
    const receipt = buildReceipt(order, [cash], settings, 'en-GB');
    expect(receipt.time).toBe('21:05');
    expect(receipt.date).toBe('26 Oct 2026');
  });

  it('lists live payments with tendered and change; a voided one is left out', () => {
    const voided: ReceiptPayment = {
      ...cash,
      amount: 50000,
      tendered: 50000,
      voided_at: '2026-10-26T16:01:00Z',
    };
    const card: ReceiptPayment = {
      method: 'card',
      amount: 2850,
      tendered: null,
      reference: 'AUTH 42',
      received_at: '2026-10-26T16:04:00Z',
      voided_at: null,
    };
    const receipt = buildReceipt(order, [voided, card, cash], settings, 'en');
    expect(receipt.payments).toEqual([
      { method: 'card', amount: 2850, tendered: null, change: null, reference: 'AUTH 42' },
      { method: 'cash', amount: 102850, tendered: 150000, change: 47150, reference: null },
    ]);
  });

  it('shows a discount only when there is one; Take Away names the customer', () => {
    const receipt = buildReceipt(
      { ...order, table_number: null, customer_name: 'Ali', discount: 5000, total: 97850 },
      [],
      settings,
      'en',
    );
    expect(receipt.totals.map((t) => t.key)).toEqual([
      'subtotal',
      'discount',
      'serviceCharge',
      'tax',
      'total',
    ]);
    expect(receipt.servedTo).toEqual({ kind: 'takeAway', name: 'Ali' });
  });

  it('never carries a cost field', () => {
    expect(JSON.stringify(buildReceipt(order, [cash], settings, 'en'))).not.toMatch(/cost/i);
  });
});
