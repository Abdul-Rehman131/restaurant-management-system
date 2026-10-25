import {
  Button,
  EmptyState,
  ErrorState,
  Input,
  MoneyText,
  QtyStepper,
  SkeletonList,
  cn,
  toast,
} from '@rms/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ListChecks, Plus, Search, Send, UtensilsCrossed } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useAuth } from '../../auth/auth-context';
import { newRequestId } from '../../lib/request-id';
import { rpcErrorCode, rpcErrorKey, type RpcErrorKey } from '../../lib/rpc';
import { useConnection } from '../../shell/connection-context';
import {
  addItem,
  itemCount,
  quantityOf,
  removeLine,
  setQuantity,
  toRpcItems,
  withRequestId,
} from './cart';
import { draftKey, useCartStore, useDraft } from './cart-store';
import {
  menuQuery,
  waiterKeys,
  waiterRpc,
  type MenuItem,
  type MyOrder,
  type TableRow,
} from './data';
import { batchLabel } from './format';
import { BatchBadge, ScreenTitle } from './parts';
import { waiterPaths } from './paths';
import { ReviewSheet } from './ReviewSheet';

const normalize = (text: string) => text.toLocaleLowerCase().normalize('NFKD');

/**
 * Order entry (plan 4.11): sticky search and category chips, the active menu (cached, so it
 * works offline for browsing), sold-out items greyed and not selectable, a sticky bar with the
 * item count and Send to Kitchen. For a new order on a free table, or an ADD-ON batch on my
 * open order (BR-06). The cart stays on the device until the server confirms.
 */
export function OrderEntry({ table, order }: { table: TableRow; order: MyOrder | null }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const { canSend } = useConnection();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const menu = useQuery(menuQuery);

  const key = draftKey(session?.user.id ?? '', table.id, order?.id ?? null);
  const draft = useDraft(key);
  const update = useCartStore((state) => state.update);
  const clear = useCartStore((state) => state.clear);

  const [category, setCategory] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<RpcErrorKey | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  const itemsById = useMemo(
    () => new Map((menu.data?.items ?? []).map((item) => [item.id, item] as const)),
    [menu.data],
  );
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

  // A line whose item went Sold Out (or off the menu) since it was added blocks Send.
  const unavailable = useMemo(
    () =>
      new Set(
        draft.lines
          .filter((line) => !itemsById.get(line.menuItemId)?.is_available)
          .map((line) => line.key),
      ),
    [draft.lines, itemsById],
  );
  const count = itemCount(draft);

  const add = (item: MenuItem) => {
    setError(null);
    update(key, (d) => addItem(d, { id: item.id, name: item.name }, newRequestId));
  };
  const setItemQuantity = (item: MenuItem, quantity: number) => {
    setError(null);
    update(key, (d) => {
      // The menu row's stepper changes the item's first line; notes lines are edited in Review.
      const line = d.lines.find((l) => l.menuItemId === item.id);
      if (!line) return d;
      const others = quantityOf(d, item.id) - line.quantity;
      return quantity - others <= 0
        ? removeLine(d, line.key)
        : setQuantity(d, line.key, quantity - others);
    });
  };

  async function send() {
    if (sending.current || !canSend || count === 0 || unavailable.size > 0) return;
    // Pressed and pending in this frame; a second tap is ignored (plan 4.6 rule 1).
    sending.current = true;
    setPending(true);
    setError(null);
    // The request id is made now and kept until the server confirms (BR-15).
    const ready = withRequestId(useCartStore.getState().drafts[key] ?? draft, newRequestId);
    update(key, () => ready);
    const requestId = ready.requestId ?? newRequestId();
    try {
      const done = order
        ? t('waiter.addOnSent', {
            batch: (await waiterRpc.addItems(requestId, order.id, toRpcItems(ready))).batch_no,
          })
        : t('waiter.sent', {
            number: (await waiterRpc.createOrder(requestId, table.id, toRpcItems(ready)))
              .order_number,
          });
      // Show the order only as the server has it (hard rule 9), then drop the cart.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: waiterKeys.myOrders }),
        queryClient.invalidateQueries({ queryKey: waiterKeys.tables }),
      ]);
      clear(key);
      setReviewOpen(false);
      toast.success(done);
      void navigate(waiterPaths.table(table.id), { replace: true });
    } catch (err) {
      const code = rpcErrorCode(err);
      if (code === 'REQUEST_ID_CONFLICT') {
        // An earlier attempt did go through: show it; the next Send is a new request.
        update(key, (d) => ({ ...d, requestId: null }));
        void queryClient.invalidateQueries({ queryKey: waiterKeys.all });
      } else if (code === 'ITEM_UNAVAILABLE' || code === 'ITEM_NOT_FOUND') {
        void queryClient.invalidateQueries({ queryKey: waiterKeys.menu });
      } else if (code === 'TABLE_HAS_OPEN_ORDER' || code === 'ORDER_CLOSED') {
        void queryClient.invalidateQueries({ queryKey: waiterKeys.all });
      }
      setError(rpcErrorKey(err));
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  const sendLabel = order ? t('waiter.sendAddOn') : t('waiter.send');
  const sendButton = (
    <Button
      size="lg"
      loading={pending}
      disabled={!canSend || count === 0 || unavailable.size > 0}
      onClick={() => void send()}
    >
      <Send aria-hidden className="rtl:-scale-x-100" />
      {sendLabel}
    </Button>
  );

  let list;
  if (menu.isPending) {
    list = <SkeletonList rows={8} className="mt-4" />;
  } else if (menu.isError && !menu.data) {
    list = (
      <ErrorState
        title={t('waiter.loadFailed')}
        description={t('waiter.loadFailedBody')}
        retryLabel={t('waiter.retry')}
        retrying={menu.isFetching}
        onRetry={() => void menu.refetch()}
      />
    );
  } else if (menu.data.items.length === 0) {
    list = <EmptyState icon={UtensilsCrossed} title={t('waiter.menuEmpty')} />;
  } else if (shown.length === 0) {
    list = <p className="py-10 text-center text-fg-muted">{t('waiter.noResults', { query })}</p>;
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
                  {t('waiter.soldOut')}
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
                  aria-label={t('waiter.add', { name: item.name })}
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
    <>
      <ScreenTitle
        back={order ? waiterPaths.table(table.id) : waiterPaths.tables}
        title={t('waiter.table', { number: table.number })}
        subtitle={
          order
            ? t('waiter.addingTo', { number: order.order_number })
            : t('waiter.seats', { count: table.capacity })
        }
      />
      <div className="sticky top-14 z-20 -mx-4 space-y-2 border-b border-border bg-bg/95 px-4 pt-1 pb-2 backdrop-blur">
        <label className="relative block">
          <span className="sr-only">{t('waiter.searchLabel')}</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted"
          />
          <Input
            type="search"
            value={query}
            placeholder={t('waiter.searchPlaceholder')}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className="ps-10"
          />
        </label>
        <nav aria-label={t('waiter.categories')} className="-mx-4 overflow-x-auto px-4">
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
                {t('waiter.all')}
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

      {order && order.order_batches.length > 0 && (
        <section aria-label={t('waiter.alreadySent')} className="mt-3 rounded-lg bg-surface-2 p-3">
          <h2 className="text-sm font-semibold text-fg-muted">{t('waiter.alreadySent')}</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {order.order_batches.map((batch) => (
              <li key={batch.id} className="flex items-center gap-2 text-sm">
                {batchLabel(t, batch.batch_no)}
                <BatchBadge status={batch.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex-1 pb-4">{list}</div>

      <div className="sticky bottom-0 z-30 -mx-4">
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 border-t border-danger/30 bg-danger-bg px-4 py-3 text-danger"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
            <p className="font-medium">{t(error)}</p>
          </div>
        )}
        {/* The bar of plan 4.11, in two rows on a phone: count, then Review and Send. */}
        <div className="border-t border-border bg-surface/95 px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-md backdrop-blur">
          <div className="flex items-baseline justify-between gap-3">
            <p className="shrink-0 font-semibold">
              {count > 0 ? t('waiter.items', { count }) : t('waiter.noItems')}
            </p>
            <p className="min-w-0 truncate text-sm text-fg-muted">
              {unavailable.size > 0 ? t('waiter.cartHasSoldOut') : t('waiter.totalOnSend')}
            </p>
          </div>
          <div className="mt-2 grid grid-cols-[auto_1fr] gap-3">
            <Button
              variant="outline"
              size="lg"
              className="px-4"
              disabled={count === 0}
              onClick={() => {
                setReviewOpen(true);
              }}
            >
              <ListChecks aria-hidden />
              {t('waiter.review')}
            </Button>
            {sendButton}
          </div>
        </div>
      </div>

      <ReviewSheet
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={t('waiter.reviewTitle', { number: table.number })}
        draftKey={key}
        unavailable={unavailable}
        error={error}
        onEdit={() => {
          setError(null);
        }}
        sendButton={sendButton}
      />
    </>
  );
}
