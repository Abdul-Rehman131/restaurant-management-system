import { describe, expect, it } from 'vitest';

import {
  RECENT_LIMIT,
  addRecentlyReady,
  newTickets,
  sortTickets,
  ticketAge,
  ticketLabel,
  type Ticket,
} from './queue';

const base = Date.parse('2026-10-25T12:00:00Z');
const minutesAgo = (m: number) => new Date(base - m * 60_000).toISOString();

const ticket = (over: Partial<Ticket>): Ticket => ({
  batch_id: 'b1',
  order_id: 'o1',
  order_number: 'ORD-20261025-001',
  order_type: 'dine_in',
  table_number: 7,
  customer_name: null,
  batch_no: 1,
  is_addon: false,
  status: 'sent',
  sent_at: minutesAgo(0),
  preparing_at: null,
  items: [{ order_item_id: 'i1', name: 'Tikka', quantity: 1, notes: null }],
  ...over,
});

describe('ticket age (settings kitchen_warn_min 10, kitchen_late_min 20)', () => {
  it('is green under the warn time', () => {
    expect(ticketAge(minutesAgo(0), base, 10, 20)).toEqual({ minutes: 0, band: 'fresh' });
    expect(ticketAge(minutesAgo(9.9), base, 10, 20)).toEqual({ minutes: 9, band: 'fresh' });
  });

  it('is amber from the warn time to the late time', () => {
    expect(ticketAge(minutesAgo(10), base, 10, 20)).toEqual({ minutes: 10, band: 'aging' });
    expect(ticketAge(minutesAgo(19.5), base, 10, 20).band).toBe('aging');
  });

  it('is red from the late time on', () => {
    expect(ticketAge(minutesAgo(20), base, 10, 20)).toEqual({ minutes: 20, band: 'late' });
    expect(ticketAge(minutesAgo(95), base, 10, 20)).toEqual({ minutes: 95, band: 'late' });
  });

  it('follows the settings, not fixed numbers', () => {
    expect(ticketAge(minutesAgo(6), base, 5, 8).band).toBe('aging');
    expect(ticketAge(minutesAgo(6), base, 15, 30).band).toBe('fresh');
  });

  it('never goes below zero when the clocks disagree', () => {
    expect(ticketAge(new Date(base + 90_000).toISOString(), base, 10, 20).minutes).toBe(0);
  });
});

describe('ticket order', () => {
  it('oldest first, then order number, then batch', () => {
    const tickets = [
      ticket({ batch_id: 'new', sent_at: minutesAgo(1) }),
      ticket({ batch_id: 'addon', batch_no: 2, sent_at: minutesAgo(5) }),
      ticket({ batch_id: 'old', sent_at: minutesAgo(12) }),
      ticket({ batch_id: 'first', batch_no: 1, sent_at: minutesAgo(5) }),
      ticket({ batch_id: 'other', order_number: 'ORD-20261025-000', sent_at: minutesAgo(5) }),
    ];
    expect(sortTickets(tickets).map((t) => t.batch_id)).toEqual([
      'old',
      'other',
      'first',
      'addon',
      'new',
    ]);
  });
});

describe('ticket label', () => {
  it('Dine-In: the table; Take Away: the customer; else the order number', () => {
    expect(ticketLabel(ticket({}))).toEqual({ kind: 'table', table: 7 });
    expect(
      ticketLabel(ticket({ table_number: null, order_type: 'take_away', customer_name: 'Ali' })),
    ).toEqual({ kind: 'customer', name: 'Ali' });
    expect(ticketLabel(ticket({ table_number: null, customer_name: null }))).toEqual({
      kind: 'order',
      orderNumber: 'ORD-20261025-001',
    });
  });
});

describe('new tickets and recently ready', () => {
  it('a ticket is new until it was seen once', () => {
    const tickets = [ticket({ batch_id: 'a' }), ticket({ batch_id: 'b' })];
    expect(newTickets(new Set(['a']), tickets)).toEqual(['b']);
    expect(newTickets(new Set(['a', 'b']), tickets)).toEqual([]);
  });

  it('keeps the last few Ready tickets, newest first, without duplicates', () => {
    let list = addRecentlyReady([], ticket({ batch_id: 'a' }), 1);
    list = addRecentlyReady(list, ticket({ batch_id: 'b' }), 2);
    list = addRecentlyReady(list, ticket({ batch_id: 'a' }), 3);
    expect(list.map((r) => [r.ticket.batch_id, r.readyAt])).toEqual([
      ['a', 3],
      ['b', 2],
    ]);
    for (let i = 0; i < 10; i++)
      list = addRecentlyReady(list, ticket({ batch_id: `x${String(i)}` }), i);
    expect(list).toHaveLength(RECENT_LIMIT);
  });
});
