import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';

import { salesSummaryResponse } from './reports';

describe('get_sales_summary response', () => {
  const summary = {
    business_date: '2026-10-25',
    orders_count: 3,
    gross_sales: 88750,
    net_sales: 75000,
    discount: 5000,
    service_charge: 1750,
    tax: 12000,
    average_order_value: 29583,
    cancelled_count: 1,
    open_count: 1,
    by_type: [
      { type: 'dine_in', orders: 1, sales: 42350 },
      { type: 'take_away', orders: 2, sales: 46400 },
      { type: 'delivery', orders: 0, sales: 0 },
    ],
    top_items: [
      {
        menu_item_id: '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f',
        name: 'Tea',
        quantity: 3,
        sales: 30000,
      },
    ],
    by_hour: Array.from({ length: 24 }, (_, i) => ({
      hour: (i + 4) % 24,
      orders: i === 8 ? 3 : 0,
      sales: i === 8 ? 88750 : 0,
    })),
  };

  it('accepts the daily report', () => {
    expect(z.parse(salesSummaryResponse, summary).gross_sales).toBe(88750);
  });

  it('rejects a float average (money is integers)', () => {
    expect(() =>
      z.parse(salesSummaryResponse, { ...summary, average_order_value: 29583.33 }),
    ).toThrow();
  });
});
