import { describe, expect, it } from 'vitest';

import {
  MoneyFormatError,
  amountToInput,
  formatMoney,
  minorUnitsToDecimal,
  parseAmount,
} from './money';

const pkr = { currencyCode: 'PKR', minorUnits: 2, locale: 'en' } as const;
// Intl puts a no-break space between the symbol and the amount, so they never wrap apart.
const rs = (amount: string) => `Rs\u00a0${amount}`;

describe('minorUnitsToDecimal', () => {
  it('splits integers exactly', () => {
    expect(minorUnitsToDecimal(145280, 2)).toBe('1452.80');
    expect(minorUnitsToDecimal(5, 2)).toBe('0.05');
    expect(minorUnitsToDecimal(0, 2)).toBe('0.00');
    expect(minorUnitsToDecimal(-9280, 2)).toBe('-92.80');
    expect(minorUnitsToDecimal(1452, 0)).toBe('1452');
    expect(minorUnitsToDecimal(1234, 3)).toBe('1.234');
  });

  it('keeps bigint amounts beyond the safe float range exact', () => {
    expect(minorUnitsToDecimal(9007199254740993n, 2)).toBe('90071992547409.93');
  });

  it('rejects anything that is not an integer amount', () => {
    expect(() => minorUnitsToDecimal(1452.5, 2)).toThrow(MoneyFormatError);
    expect(() => minorUnitsToDecimal(Number.NaN, 2)).toThrow(MoneyFormatError);
    expect(() => minorUnitsToDecimal(2 ** 53, 2)).toThrow(MoneyFormatError);
    expect(() => minorUnitsToDecimal(100, 4)).toThrow(MoneyFormatError);
  });
});

describe('formatMoney', () => {
  it('formats the T6 hand-checked totals', () => {
    expect(formatMoney(145200, pkr)).toBe(rs('1,452'));
    expect(formatMoney(9280, pkr)).toBe(rs('92.80'));
    expect(formatMoney(181500, pkr)).toBe(rs('1,815'));
  });

  it('can always show the fraction (receipts)', () => {
    expect(formatMoney(145200, { ...pkr, fraction: 'always' })).toBe(rs('1,452.00'));
  });

  it('uses the currency from the settings it is given', () => {
    expect(formatMoney(145200, { ...pkr, currencyCode: 'USD' })).toBe('$1,452');
  });

  it('keeps Latin digits in RTL languages', () => {
    expect(formatMoney(145200, { ...pkr, locale: 'ur' })).toMatch(/1,452/);
    expect(formatMoney(145200, { ...pkr, locale: 'ar' })).toMatch(/1,452/);
  });

  it('formats negative amounts (refunds, voids)', () => {
    expect(formatMoney(-4800, pkr)).toBe(`-${rs('48')}`);
  });
});

describe('parseAmount (typed text to minor units, no floats)', () => {
  it('reads whole and decimal amounts exactly', () => {
    expect(parseAmount('1028.50', 2)).toBe(102850);
    expect(parseAmount('1,028.5', 2)).toBe(102850);
    expect(parseAmount(' 5 000 ', 2)).toBe(500000);
    expect(parseAmount('0.10', 2)).toBe(10);
    expect(parseAmount('.5', 2)).toBeNull();
    expect(parseAmount('12.', 2)).toBe(1200);
    expect(parseAmount('0', 2)).toBe(0);
  });

  it('avoids float rounding: 0.1 + 0.2 style inputs stay exact', () => {
    expect(parseAmount('1.15', 2)).toBe(115);
    expect(parseAmount('4.35', 2)).toBe(435);
    expect(parseAmount('1.005', 3)).toBe(1005);
  });

  it('refuses signs, letters, too many decimals and absurd sizes', () => {
    expect(parseAmount('-5', 2)).toBeNull();
    expect(parseAmount('5e3', 2)).toBeNull();
    expect(parseAmount('Rs 50', 2)).toBeNull();
    expect(parseAmount('1.234', 2)).toBeNull();
    expect(parseAmount('12.5', 0)).toBeNull();
    expect(parseAmount('', 2)).toBeNull();
    expect(parseAmount('1234567890123', 2)).toBeNull();
  });

  it('follows the currency: 0 and 3 minor units', () => {
    expect(parseAmount('1200', 0)).toBe(1200);
    expect(parseAmount('1.234', 3)).toBe(1234);
  });

  it('round-trips with amountToInput', () => {
    expect(amountToInput(102850, 2)).toBe('1028.50');
    expect(amountToInput(5, 2)).toBe('0.05');
    expect(amountToInput(1200, 0)).toBe('1200');
    expect(parseAmount(amountToInput(987654, 2), 2)).toBe(987654);
  });
});
