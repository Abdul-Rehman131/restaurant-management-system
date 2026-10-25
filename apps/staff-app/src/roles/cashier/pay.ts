/**
 * Payment pad rules (M7, BR-11), pure so they are unit-tested (pay.test.ts). Amounts are
 * integers in minor units (CLAUDE.md rule 5): typed text is parsed as a decimal string, never
 * through a float. The server checks every tender again (record_payment); these only help
 * the cashier type and see the change before paying.
 */

/** 12 digits of major units is far beyond any bill; it also keeps numbers exact. */
const MAX_WHOLE_DIGITS = 12;

/**
 * "1,028.50" -> 102850 (2 minor units). Grouping commas and spaces are allowed; a sign, letters
 * or more decimals than the currency has are not. Returns null when the text is not an amount.
 */
export function parseAmount(text: string, minorUnits: number): number | null {
  const cleaned = text.replace(/[\s,]/g, '');
  const match = /^(\d+)(?:\.(\d*))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  if (whole.length > MAX_WHOLE_DIGITS || fraction.length > minorUnits) return null;
  const digits = (whole + fraction.padEnd(minorUnits, '0')).replace(/^0+(?=\d)/, '');
  return Number(digits);
}

/** Minor units back to the text the field shows: 102850 -> "1028.50" (no grouping). */
export function amountToInput(amount: number, minorUnits: number): string {
  if (minorUnits === 0) return String(amount);
  const text = String(amount).padStart(minorUnits + 1, '0');
  return `${text.slice(0, -minorUnits)}.${text.slice(-minorUnits)}`;
}

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
