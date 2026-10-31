import type { rpc } from '@rms/shared';

/**
 * Open bills list rules (plan 4.5), pure so they are unit-tested (bills.test.ts):
 * Bill Requested first (oldest request first), then Take Away orders that are Ready (the
 * customer is waiting at the counter), then everything else by age.
 */
export type Bill = rpc.OpenBill;

function rank(bill: Bill): number {
  if (bill.bill_requested) return 0;
  if (bill.type === 'take_away' && bill.status === 'ready') return 1;
  return 2;
}

const time = (value: string | null) => (value ? Date.parse(value) : 0);

export function sortBills(bills: readonly Bill[]): Bill[] {
  return [...bills].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 0 ? time(a.bill_requested_at) - time(b.bill_requested_at) : 0) ||
      time(a.created_at) - time(b.created_at) ||
      a.order_number.localeCompare(b.order_number),
  );
}

/**
 * Bills that asked for the bill since the last look (the soft tone and the badge). `known`
 * holds every order that already had the bill requested at the first look of this session.
 */
export function newBillRequests(known: ReadonlySet<string>, bills: readonly Bill[]): string[] {
  return bills.filter((b) => b.bill_requested && !known.has(b.order_id)).map((b) => b.order_id);
}

export function requestedBills(bills: readonly Bill[]): Set<string> {
  return new Set(bills.filter((b) => b.bill_requested).map((b) => b.order_id));
}
