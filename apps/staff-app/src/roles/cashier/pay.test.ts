import { describe, expect, it } from 'vitest';

import { amountToInput, changeDue, parseAmount, quickCash, toTenders } from './pay';

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

describe('quick cash and change', () => {
  it('Exact, then the next round 500 and 1000 (PKR, 2 minor units)', () => {
    expect(quickCash(102850, 2)).toEqual([102850, 150000, 200000]);
    expect(quickCash(450000, 2)).toEqual([450000, 500000]);
    expect(quickCash(100000, 2)).toEqual([100000]);
  });

  it('change is what is left after the amount due; too little cash has none', () => {
    expect(changeDue(102850, 150000)).toBe(47150);
    expect(changeDue(102850, 102850)).toBe(0);
    expect(changeDue(102850, 100000)).toBeNull();
    expect(changeDue(102850, null)).toBeNull();
  });
});

describe('tenders for record_payment', () => {
  it('cash sends the amount and the cash received; card an optional reference', () => {
    expect(toTenders({ cash: { amount: 102850, tendered: 150000 }, card: null })).toEqual([
      { method: 'cash', amount: 102850, tendered: 150000 },
    ]);
    expect(toTenders({ cash: null, card: { amount: 102850, reference: '  ' } })).toEqual([
      { method: 'card', amount: 102850 },
    ]);
    expect(toTenders({ cash: null, card: { amount: 102850, reference: 'AUTH 42' } })).toEqual([
      { method: 'card', amount: 102850, reference: 'AUTH 42' },
    ]);
  });

  it('a split sends both parts and skips an empty one', () => {
    expect(
      toTenders({
        cash: { amount: 50000, tendered: 50000 },
        card: { amount: 52850, reference: '' },
      }),
    ).toEqual([
      { method: 'cash', amount: 50000, tendered: 50000 },
      { method: 'card', amount: 52850 },
    ]);
    expect(
      toTenders({ cash: { amount: 0, tendered: 0 }, card: { amount: 102850, reference: '' } }),
    ).toEqual([{ method: 'card', amount: 102850 }]);
  });
});
