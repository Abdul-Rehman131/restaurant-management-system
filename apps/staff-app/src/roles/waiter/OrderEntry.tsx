import { Button, toast } from '@rms/ui';
import { useQueryClient } from '@tanstack/react-query';
import { CircleAlert, ListChecks, Send } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useAuth } from '../../auth/auth-context';
import { newRequestId } from '../../lib/request-id';
import { rpcErrorCode, rpcErrorKey, type RpcErrorKey } from '../../lib/rpc';
import { toRpcItems, withRequestId } from '../../ordering/cart';
import { draftKey, useCartStore } from '../../ordering/cart-store';
import { menuKey } from '../../ordering/menu';
import { MenuPicker } from '../../ordering/MenuPicker';
import { ReviewSheet } from '../../ordering/ReviewSheet';
import { useCartCheck } from '../../ordering/useCartCheck';
import { useConnection } from '../../shell/connection-context';
import { waiterKeys, waiterRpc, type MyOrder, type TableRow } from './data';
import { batchLabel } from './format';
import { BatchBadge, ScreenTitle } from './parts';
import { waiterPaths } from './paths';

/**
 * Order entry (plan 4.11): sticky search and category chips, the active menu (cached, so it
 * works offline for browsing), sold-out items greyed and not selectable, a sticky bar with the
 * item count and Send to Kitchen. For a new order on a free table, or an ADD-ON batch on my
 * open order (BR-06). The cart stays on the device until the server confirms.
 */
export function OrderEntry({ table, order }: { table: TableRow; order: MyOrder | null }) {
  const { t } = useTranslation(['waiter', 'rpc']);
  const { session } = useAuth();
  const { canSend } = useConnection();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const key = draftKey(session?.user.id ?? '', table.id, order?.id ?? null);
  const { draft, count, unavailable } = useCartCheck(key);
  const update = useCartStore((state) => state.update);
  const clear = useCartStore((state) => state.clear);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<RpcErrorKey | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

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
        ? t('waiter:addOnSent', {
            batch: (await waiterRpc.addItems(requestId, order.id, toRpcItems(ready))).batch_no,
          })
        : t('waiter:sent', {
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
        void queryClient.invalidateQueries({ queryKey: menuKey });
      } else if (code === 'TABLE_HAS_OPEN_ORDER' || code === 'ORDER_CLOSED') {
        void queryClient.invalidateQueries({ queryKey: waiterKeys.all });
      }
      setError(rpcErrorKey(err));
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  const sendLabel = order ? t('waiter:sendAddOn') : t('waiter:send');
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

  return (
    <>
      <ScreenTitle
        back={order ? waiterPaths.table(table.id) : waiterPaths.tables}
        title={t('waiter:table', { number: table.number })}
        subtitle={
          order
            ? t('waiter:addingTo', { number: order.order_number })
            : t('waiter:seats', { count: table.capacity })
        }
      />
      {order && order.order_batches.length > 0 && (
        <section aria-label={t('waiter:alreadySent')} className="mb-3 rounded-lg bg-surface-2 p-3">
          <h2 className="text-sm font-semibold text-fg-muted">{t('waiter:alreadySent')}</h2>
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

      <MenuPicker
        draftKey={key}
        className="top-14"
        onEdit={() => {
          setError(null);
        }}
      />

      <div className="flex-1 pb-4" />

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
              {count > 0 ? t('waiter:items', { count }) : t('waiter:noItems')}
            </p>
            <p className="min-w-0 truncate text-sm text-fg-muted">
              {unavailable.size > 0 ? t('waiter:cartHasSoldOut') : t('waiter:totalOnSend')}
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
              {t('waiter:review')}
            </Button>
            {sendButton}
          </div>
        </div>
      </div>

      <ReviewSheet
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={t('waiter:reviewTitle', { number: table.number })}
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
