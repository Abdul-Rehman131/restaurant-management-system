import { describe, expect, it } from 'vitest';

import { changeDue, quickCash, toTenders } from './pay';

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
