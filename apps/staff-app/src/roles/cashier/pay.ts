/**
 * Payment pad rules (M7, BR-11), pure so they are unit-tested (pay.test.ts). Amounts are
 * integers in minor units (CLAUDE.md rule 5): typed text is parsed by parseAmount
 * (@rms/shared, shared with the admin price fields), never through a float. The server checks
 * every tender again (record_payment); these only help the cashier type and see the change.
 */

/**
 * Quick-cash buttons (plan 4.9): Exact, then the next round 500 and 1000 of the currency's
 * major unit above the amount due, without duplicates.
 */
export function quickCash(due: number, minorUnits: number): number[] {
  const unit = 10 ** minorUnits;
  const roundUp = (step: number) => Math.ceil(due / (step * unit)) * step * unit;
  const options = [due, roundUp(500), roundUp(1000)];
  return [...new Set(options)].filter((amount) => amount >= due);
}

/** Change for cash received, or null when it is not enough (the server refuses it too). */
export function changeDue(due: number, received: number | null): number | null {
  if (received === null || received < due) return null;
  return received - due;
}

export type Tender =
  | { method: 'cash'; amount: number; tendered: number }
  | { method: 'card'; amount: number; reference?: string };

/**
 * The p_tenders argument of record_payment. Cash: the amount applied and the cash received;
 * card: the amount and an optional reference. A split sends both (BR-11).
 */
export function toTenders(input: {
  cash: { amount: number; tendered: number } | null;
  card: { amount: number; reference: string } | null;
}): Tender[] {
  const tenders: Tender[] = [];
  if (input.cash && input.cash.amount > 0) {
    tenders.push({ method: 'cash', amount: input.cash.amount, tendered: input.cash.tendered });
  }
  if (input.card && input.card.amount > 0) {
    const reference = input.card.reference.trim();
    tenders.push(
      reference
        ? { method: 'card', amount: input.card.amount, reference }
        : { method: 'card', amount: input.card.amount },
    );
  }
  return tenders;
}
