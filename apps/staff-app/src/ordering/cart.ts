/**
 * The waiter's cart: local state only (CLAUDE.md, Zustand for cart and UI state). It holds
 * item ids, quantities and notes, never prices: totals come from the server (BR-01). Pure
 * functions, so the rules are unit-tested (cart.test.ts); the store is in cart-store.ts.
 */

/** Server limits (private.validate_order_lines): 1 to 99 per line, notes up to 200, 50 lines. */
export const MAX_QTY = 99;
export const MAX_NOTES = 200;
export const MAX_LINES = 50;

export interface CartLine {
  /** Local id of the line (two lines of one item can carry different notes). */
  key: string;
  menuItemId: string;
  /** For display only; the server snapshots the real name (BR-02). */
  name: string;
  quantity: number;
  notes: string;
}

export interface Draft {
  lines: CartLine[];
  /**
   * Set when Send is first tapped and kept until the server confirms (BR-15): a retry, even
   * after editing the cart, reuses it. The server stores nothing for a failed attempt, so an
   * edited retry still succeeds; if an earlier attempt did go through, the server answers
   * REQUEST_ID_CONFLICT instead of creating a second order or batch.
   */
  requestId: string | null;
}

export const emptyDraft: Draft = { lines: [], requestId: null };

const clampQty = (quantity: number) => Math.min(MAX_QTY, Math.max(1, Math.trunc(quantity)));

/** One tap on a menu row: +1 on the item's line without notes, else a new line. */
export function addItem(
  draft: Draft,
  item: { id: string; name: string },
  newKey: () => string,
): Draft {
  const index = draft.lines.findIndex((l) => l.menuItemId === item.id && l.notes === '');
  if (index >= 0) {
    const line = draft.lines[index];
    if (!line || line.quantity >= MAX_QTY) return draft;
    return {
      ...draft,
      lines: draft.lines.map((l, i) => (i === index ? { ...l, quantity: l.quantity + 1 } : l)),
    };
  }
  if (draft.lines.length >= MAX_LINES) return draft;
  const line: CartLine = {
    key: newKey(),
    menuItemId: item.id,
    name: item.name,
    quantity: 1,
    notes: '',
  };
  return { ...draft, lines: [...draft.lines, line] };
}

export function setQuantity(draft: Draft, key: string, quantity: number): Draft {
  return {
    ...draft,
    lines: draft.lines.map((l) => (l.key === key ? { ...l, quantity: clampQty(quantity) } : l)),
  };
}

export function setNotes(draft: Draft, key: string, notes: string): Draft {
  return {
    ...draft,
    lines: draft.lines.map((l) => (l.key === key ? { ...l, notes: notes.slice(0, MAX_NOTES) } : l)),
  };
}

export function removeLine(draft: Draft, key: string): Draft {
  return { ...draft, lines: draft.lines.filter((l) => l.key !== key) };
}

/** Total quantity of an item across its lines (the stepper on the menu row). */
export function quantityOf(draft: Draft, menuItemId: string): number {
  return draft.lines.reduce((sum, l) => (l.menuItemId === menuItemId ? sum + l.quantity : sum), 0);
}

/** The item count shown before sending: no amount is calculated on the device (BR-01). */
export function itemCount(draft: Draft): number {
  return draft.lines.reduce((sum, l) => sum + l.quantity, 0);
}

/** The request id for this send: the existing one on a retry, else a new one. */
export function withRequestId(draft: Draft, newId: () => string): Draft {
  return draft.requestId ? draft : { ...draft, requestId: newId() };
}

/** The `p_items` argument of create_order and add_items_to_order: ids, quantities, notes. */
export function toRpcItems(
  draft: Draft,
): { menu_item_id: string; quantity: number; notes?: string }[] {
  return draft.lines.map((l) => {
    const notes = l.notes.trim();
    return notes
      ? { menu_item_id: l.menuItemId, quantity: l.quantity, notes }
      : { menu_item_id: l.menuItemId, quantity: l.quantity };
  });
}
