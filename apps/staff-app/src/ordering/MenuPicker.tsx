import './i18n';

import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  MoneyText,
  QtyStepper,
  SkeletonList,
  cn,
} from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, UtensilsCrossed } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { newRequestId } from '../lib/request-id';
import { addItem, quantityOf, removeLine, setQuantity } from './cart';
import { useCartStore, useDraft } from './cart-store';
import { menuQuery, type MenuItem } from './menu';

const normalize = (text: string) => text.toLocaleLowerCase().normalize('NFKD');

/**
 * The menu picker of order entry (plan 4.11), shared by the waiter and the counter:
 * search over the cached menu (works offline for browsing), category chips, items from the
 * active menu with their menu price (no cost price), Sold Out items greyed without a button
 * (BR-13), tap a row for +1 and a QtyStepper once it is in the cart. It edits the cart draft
 * `draftKey`; the caller owns Review and Send.
 *
 * It fills the rest of the caller's column (a flex column of bounded height): the search and
 * chips stay on top and only the list scrolls, below them. Nothing scrolls under a sticky bar,
 * so no button is ever half covered by one (axe target-size, plan 4.6 rule 9).
 */
export function MenuPicker({
  draftKey,
  onEdit,
}: {
  draftKey: string;
  /** Called on every cart change (clears a stale error). */
  onEdit?: () => void;
}) {
  const { t } = useTranslation(['ordering', 'rpc']);
  const menu = useQuery(menuQuery);
  const draft = useDraft(draftKey);
  const update = useCartStore((state) => state.update);
  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const items = menu.data?.items ?? [];
    const words = normalize(query.trim());
    if (words) {
      return items.filter((item) =>
        normalize(`${item.name} ${item.description ?? ''}`).includes(words),
      );
    }
    return category ? items.filter((item) => item.category_id === category) : items;
  }, [menu.data, query, category]);

  const add = (item: MenuItem) => {
    onEdit?.();
    update(draftKey, (d) => addItem(d, { id: item.id, name: item.name }, newRequestId));
  };
  const setItemQuantity = (item: MenuItem, quantity: number) => {
    onEdit?.();
    update(draftKey, (d) => {
      // The row's stepper changes the item's first line; lines with notes are edited in Review.
      const line = d.lines.find((l) => l.menuItemId === item.id);
      if (!line) return d;
      const others = quantityOf(d, item.id) - line.quantity;
      return quantity - others <= 0
        ? removeLine(d, line.key)
        : setQuantity(d, line.key, quantity - others);
    });
  };

  let list;
  if (menu.isPending) {
    list = <SkeletonList rows={8} className="mt-4" />;
  } else if (menu.isError && !menu.data) {
    list = (
      <ErrorState
        title={t('ordering:loadFailed')}
        description={t('ordering:loadFailedBody')}
        retryLabel={t('ordering:retry')}
        retrying={menu.isFetching}
        onRetry={() => void menu.refetch()}
      />
    );
  } else if (menu.data.items.length === 0) {
    list = <EmptyState icon={UtensilsCrossed} title={t('ordering:menuEmpty')} />;
  } else if (shown.length === 0) {
    list = <p className="py-10 text-center text-fg-muted">{t('ordering:noResults', { query })}</p>;
  } else {
    list = (
      <ul className="divide-y divide-border">
        {shown.map((item) => {
          const quantity = quantityOf(draft, item.id);
          if (!item.is_available) {
            // Sold Out (BR-13): no button, so it cannot be added.
            return (
              <li
                key={item.id}
                className="flex min-h-control-lg items-center gap-3 py-2 text-fg-muted"
              >
                <span className="min-w-0 flex-1 truncate line-through decoration-1">
                  {item.name}
                </span>
                <span className="rounded-full bg-surface-2 px-3 py-1 text-sm font-semibold">
                  {t('ordering:soldOut')}
                </span>
              </li>
            );
          }
          return (
            <li key={item.id} className="flex min-h-control-lg items-center gap-2 py-1">
              {/* Tap the row = +1 (plan 4.11). */}
              <button
                type="button"
                onClick={() => {
                  add(item);
                }}
                className="flex min-h-control-md min-w-0 flex-1 flex-col items-start justify-center rounded-md py-1 text-start hover:bg-surface-2"
              >
                <span className="w-full truncate font-medium">{item.name}</span>
                <MoneyText amount={item.price} className="text-sm text-fg-muted" />
              </button>
              {quantity > 0 ? (
                <QtyStepper
                  value={quantity}
                  itemName={item.name}
                  onChange={(value) => {
                    setItemQuantity(item, value);
                  }}
                  onRemove={() => {
                    setItemQuantity(item, 0);
                  }}
                />
              ) : (
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t('ordering:add', { name: item.name })}
                  onClick={() => {
                    add(item);
                  }}
                >
                  <Plus aria-hidden />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    );
  }

  const categories = menu.data?.categories ?? [];
  const chip = (active: boolean) =>
    cn(
      'inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm font-semibold whitespace-nowrap',
      active ? 'border-brand bg-brand text-brand-fg' : 'border-border bg-surface text-fg',
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="-mx-4 shrink-0 space-y-2 border-b border-border px-4 pt-1 pb-2">
        <label className="relative block">
          <span className="sr-only">{t('ordering:searchLabel')}</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted"
          />
          <Input
            type="search"
            value={query}
            placeholder={t('ordering:searchPlaceholder')}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className="ps-10"
          />
        </label>
        <nav aria-label={t('ordering:categories')} className="-mx-4 overflow-x-auto px-4">
          <ul className="flex gap-2">
            <li>
              <button
                type="button"
                aria-pressed={category === null && !query}
                className={chip(category === null && !query)}
                onClick={() => {
                  setCategory(null);
                  setQuery('');
                }}
              >
                {t('ordering:all')}
              </button>
            </li>
            {categories.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  aria-pressed={category === c.id && !query}
                  className={chip(category === c.id && !query)}
                  onClick={() => {
                    setCategory(c.id);
                    setQuery('');
                  }}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      {/* Focusable, so the list scrolls from the keyboard too (axe scrollable-region-focusable). */}
      <div
        role="region"
        aria-label={t('ordering:menuList')}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling region must be reachable by keyboard
        tabIndex={0}
        className="-mx-4 min-h-48 flex-1 overflow-y-auto overscroll-contain px-4"
      >
        {list}
      </div>
    </div>
  );
}
