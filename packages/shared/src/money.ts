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
