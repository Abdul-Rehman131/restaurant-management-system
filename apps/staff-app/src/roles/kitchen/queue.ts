import type { rpc } from '@rms/shared';

/**
 * Kitchen queue rules (plan 4.2 and 4.9, G11), pure so they are unit-tested (queue.test.ts).
 * Ages use the server's clock: the queue carries server_time, and the device clock only
 * counts on from there, so a wrong tablet clock never colours a ticket wrongly.
 */
export type Ticket = rpc.KitchenTicket;

export type AgeBand = 'fresh' | 'aging' | 'late';

export interface TicketAge {
  minutes: number;
  band: AgeBand;
}

/**
 * Green under warn minutes, amber from warn to late, red from late on (settings
 * kitchen_warn_min and kitchen_late_min). Age counts from when the batch was sent.
 */
export function ticketAge(
  sentAt: string,
  serverNow: number,
  warnMin: number,
  lateMin: number,
): TicketAge {
  const minutes = Math.max(0, Math.floor((serverNow - Date.parse(sentAt)) / 60_000));
  const band: AgeBand = minutes >= lateMin ? 'late' : minutes >= warnMin ? 'aging' : 'fresh';
  return { minutes, band };
}

/** Oldest first; ties by order number, then batch (as get_kitchen_queue sorts). */
export function sortTickets(tickets: readonly Ticket[]): Ticket[] {
  return [...tickets].sort(
    (a, b) =>
      Date.parse(a.sent_at) - Date.parse(b.sent_at) ||
      a.order_number.localeCompare(b.order_number) ||
      a.batch_no - b.batch_no,
  );
}

/** Who the food is for: the table, else the Take Away customer, else the order number. */
export type TicketLabel =
  | { kind: 'table'; table: number }
  | { kind: 'customer'; name: string }
  | { kind: 'order'; orderNumber: string };

export function ticketLabel(ticket: Ticket): TicketLabel {
  if (ticket.table_number !== null) return { kind: 'table', table: ticket.table_number };
  if (ticket.customer_name) return { kind: 'customer', name: ticket.customer_name };
  return { kind: 'order', orderNumber: ticket.order_number };
}

/** Tickets not seen before (new orders and ADD-ONs): they get the chime and the highlight. */
export function newTickets(seen: ReadonlySet<string>, tickets: readonly Ticket[]): string[] {
  return tickets.filter((t) => !seen.has(t.batch_id)).map((t) => t.batch_id);
}

export interface RecentlyReady {
  ticket: Ticket;
  readyAt: number;
}

/** How long a Ready ticket stays on the board before it moves to the strip. */
export const READY_LINGER_MS = 4_000;
/** The strip keeps the last few tickets marked Ready on this screen. */
export const RECENT_LIMIT = 6;

/** Adds a ticket the chef just marked Ready; newest first, without duplicates. */
export function addRecentlyReady(
  list: readonly RecentlyReady[],
  ticket: Ticket,
  readyAt: number,
): RecentlyReady[] {
  return [{ ticket, readyAt }, ...list.filter((r) => r.ticket.batch_id !== ticket.batch_id)].slice(
    0,
    RECENT_LIMIT,
  );
}
