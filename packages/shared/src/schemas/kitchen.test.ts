import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';

import { kitchenQueueResponse, setBatchStatusResponse } from './kitchen';

describe('set_batch_status response', () => {
  const result = {
    batch_id: '6c4d7a0e-3f7b-4f7e-8a51-2a9d0f6c1e33',
    order_id: '2b7f1d5e-8a0c-4c47-9a53-3f0f3c1b9e21',
    batch_no: 2,
    batch_status: 'ready',
    order_status: 'ready',
    replayed: false,
  };

  it('accepts a batch marked Ready', () => {
    expect(z.parse(setBatchStatusResponse, result).order_status).toBe('ready');
  });

  it('rejects an unknown batch status', () => {
    expect(() => z.parse(setBatchStatusResponse, { ...result, batch_status: 'done' })).toThrow();
  });
});

describe('get_kitchen_queue response', () => {
  const ticket = {
    batch_id: '6c4d7a0e-3f7b-4f7e-8a51-2a9d0f6c1e33',
    order_id: '2b7f1d5e-8a0c-4c47-9a53-3f0f3c1b9e21',
    order_number: 'ORD-20261025-001',
    order_type: 'dine_in',
    table_number: 7,
    customer_name: null,
    batch_no: 2,
    is_addon: true,
    status: 'sent',
    sent_at: '2026-10-25T09:00:00.000000+00:00',
    preparing_at: null,
    items: [
      {
        order_item_id: '7d5e8b1f-4a8c-4f9e-9b62-3b0e1d7f2a44',
        name: 'Tikka',
        quantity: 2,
        notes: null,
      },
    ],
  };

  it('accepts an ADD-ON ticket', () => {
    const q = z.parse(kitchenQueueResponse, { server_time: ticket.sent_at, tickets: [ticket] });
    expect(q.tickets[0]?.is_addon).toBe(true);
  });

  it('accepts an empty kitchen', () => {
    expect(
      z.parse(kitchenQueueResponse, { server_time: ticket.sent_at, tickets: [] }).tickets,
    ).toEqual([]);
  });

  it('rejects a Ready ticket (the queue holds only Sent and Preparing batches)', () => {
    expect(() =>
      z.parse(kitchenQueueResponse, {
        server_time: ticket.sent_at,
        tickets: [{ ...ticket, status: 'ready' }],
      }),
    ).toThrow();
  });

  it('drops any extra field such as a price', () => {
    const withPrice = { ...ticket, items: [{ ...ticket.items[0], price_snapshot: 60000 }] };
    const q = z.parse(kitchenQueueResponse, { server_time: ticket.sent_at, tickets: [withPrice] });
    expect(q.tickets[0]?.items[0]).not.toHaveProperty('price_snapshot');
  });
});
