/**
 * Money is an integer in the smallest currency unit (CLAUDE.md rule 5). This is the ONE place
 * that turns it into text. No floats: the integer is split with bigint arithmetic into an exact
 * decimal string, and Intl only lays it out (symbol, grouping, sign).
 */
export type MinorUnits = bigint | number;

export interface MoneyFormat {
  /** ISO 4217 code from settings.currency_code, e.g. "PKR". */
  currencyCode: string;
  /** Digits after the decimal point, from settings.currency_minor_units (0 to 3). */
  minorUnits: number;
  /** UI language, e.g. "en". Digits always stay Latin (plan 4.6 rule 10). */
  locale: string;
  /** "auto" hides ".00" on whole amounts (Rs 1,452); "always" keeps it, e.g. for receipts. */
  fraction?: 'auto' | 'always';
}

export class MoneyFormatError extends Error {
  override name = 'MoneyFormatError';
}

export function toMinorUnits(amount: MinorUnits): bigint {
  if (typeof amount === 'bigint') return amount;
  if (!Number.isSafeInteger(amount)) {
    throw new MoneyFormatError(`money must be an integer in minor units, got ${String(amount)}`);
  }
  return BigInt(amount);
}

/** Exact decimal string for an integer amount: (145280, 2) -> "1452.80". */
export function minorUnitsToDecimal(amount: MinorUnits, minorUnits: number): string {
  if (!Number.isInteger(minorUnits) || minorUnits < 0 || minorUnits > 3) {
    throw new MoneyFormatError(`currency minor units must be 0 to 3, got ${String(minorUnits)}`);
  }
  const value = toMinorUnits(amount);
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(minorUnits + 1, '0');
  if (minorUnits === 0) return `${sign}${digits}`;
  return `${sign}${digits.slice(0, -minorUnits)}.${digits.slice(-minorUnits)}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter({ currencyCode, minorUnits, locale, fraction = 'auto' }: MoneyFormat) {
  const key = `${locale}|${currencyCode}|${String(minorUnits)}|${fraction}`;
  let cached = formatters.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currencyCode,
      currencyDisplay: 'narrowSymbol',
      numberingSystem: 'latn',
      minimumFractionDigits: minorUnits,
      maximumFractionDigits: minorUnits,
      trailingZeroDisplay: fraction === 'auto' ? 'stripIfInteger' : 'auto',
    });
    formatters.set(key, cached);
  }
  return cached;
}

/** formatMoney(145200, { currencyCode: 'PKR', minorUnits: 2, locale: 'en' }) -> "Rs 1,452" */
export function formatMoney(amount: MinorUnits, format: MoneyFormat): string {
  const decimal = minorUnitsToDecimal(amount, format.minorUnits) as Intl.StringNumericLiteral;
  return formatter(format).format(decimal);
}

// ===== Typed amounts (payment pad, admin prices) =====
// Text the user types is parsed as a decimal string into integer minor units, never through a
// float (CLAUDE.md rule 5). The server checks every amount again.

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
