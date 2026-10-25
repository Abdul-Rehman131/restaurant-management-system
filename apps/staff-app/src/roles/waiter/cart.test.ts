import { describe, expect, it } from 'vitest';

import {
  MAX_LINES,
  MAX_NOTES,
  MAX_QTY,
  addItem,
  emptyDraft,
  itemCount,
  quantityOf,
  removeLine,
  setNotes,
  setQuantity,
  toRpcItems,
  withRequestId,
  type Draft,
} from './cart';

const tikka = { id: '11111111-1111-1111-1111-111111111111', name: 'Chicken Tikka' };
const naan = { id: '22222222-2222-2222-2222-222222222222', name: 'Plain Naan' };

function keys() {
  let n = 0;
  return () => `k${String(++n)}`;
}

describe('cart', () => {
  it('a tap adds the item, a second tap adds one more to the same line', () => {
    const key = keys();
    let draft = addItem(emptyDraft, tikka, key);
    draft = addItem(draft, tikka, key);
    draft = addItem(draft, naan, key);
    expect(draft.lines.map((l) => [l.name, l.quantity])).toEqual([
      ['Chicken Tikka', 2],
      ['Plain Naan', 1],
    ]);
    expect(itemCount(draft)).toBe(3);
  });

  it('a line with notes stays separate: the next tap starts a plain line', () => {
    const key = keys();
    let draft = addItem(emptyDraft, tikka, key);
    draft = setNotes(draft, 'k1', 'no onion');
    draft = addItem(draft, tikka, key);
    expect(draft.lines).toHaveLength(2);
    expect(quantityOf(draft, tikka.id)).toBe(2);
  });

  it('keeps quantities within the server limits (1 to 99)', () => {
    const key = keys();
    let draft = addItem(emptyDraft, tikka, key);
    draft = setQuantity(draft, 'k1', 0);
    expect(draft.lines[0]?.quantity).toBe(1);
    draft = setQuantity(draft, 'k1', 500);
    expect(draft.lines[0]?.quantity).toBe(MAX_QTY);
    expect(addItem(draft, tikka, key)).toBe(draft);
    draft = setQuantity(draft, 'k1', 2.7);
    expect(draft.lines[0]?.quantity).toBe(2);
  });

  it('caps notes at 200 characters and lines at 50', () => {
    const key = keys();
    let draft = addItem(emptyDraft, tikka, key);
    draft = setNotes(draft, 'k1', 'x'.repeat(300));
    expect(draft.lines[0]?.notes).toHaveLength(MAX_NOTES);

    let full: Draft = emptyDraft;
    for (let i = 0; i < MAX_LINES; i++) {
      full = addItem(full, { id: `item-${String(i)}`, name: `Item ${String(i)}` }, key);
    }
    expect(addItem(full, naan, key)).toBe(full);
  });

  it('removes a line', () => {
    const key = keys();
    let draft = addItem(addItem(emptyDraft, tikka, key), naan, key);
    draft = removeLine(draft, 'k1');
    expect(draft.lines.map((l) => l.name)).toEqual(['Plain Naan']);
  });

  it('sends ids, quantities and trimmed notes only: never a price or a name', () => {
    const key = keys();
    let draft = addItem(addItem(emptyDraft, tikka, key), naan, key);
    draft = setNotes(draft, 'k1', '  less spicy ');
    draft = setNotes(draft, 'k2', '   ');
    expect(toRpcItems(draft)).toEqual([
      { menu_item_id: tikka.id, quantity: 1, notes: 'less spicy' },
      { menu_item_id: naan.id, quantity: 1 },
    ]);
  });

  it('keeps one request id per send, across retries and edits, until the server confirms', () => {
    const key = keys();
    let n = 0;
    const newId = () => `req-${String(++n)}`;
    let draft = withRequestId(addItem(emptyDraft, tikka, key), newId);
    expect(draft.requestId).toBe('req-1');
    draft = withRequestId(draft, newId);
    expect(draft.requestId).toBe('req-1');
    draft = withRequestId(addItem(draft, naan, key), newId);
    expect(draft.requestId).toBe('req-1');
  });
});
