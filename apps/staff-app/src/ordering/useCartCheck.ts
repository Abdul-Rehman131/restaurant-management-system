import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { itemCount } from './cart';
import { useDraft } from './cart-store';
import { menuQuery } from './menu';

/**
 * What Send needs to know about a cart: the item count (no amount: the total comes from the
 * server, BR-01) and the lines whose item went Sold Out or off the menu since they were added
 * (they block Send until removed).
 */
export function useCartCheck(draftKey: string) {
  const menu = useQuery(menuQuery);
  const draft = useDraft(draftKey);
  const unavailable = useMemo(() => {
    const items = new Map((menu.data?.items ?? []).map((item) => [item.id, item] as const));
    return new Set(
      draft.lines
        .filter((line) => !items.get(line.menuItemId)?.is_available)
        .map((line) => line.key),
    );
  }, [draft.lines, menu.data]);
  return { draft, count: itemCount(draft), unavailable };
}
