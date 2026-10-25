import { Button, Input, Label, cn, toast } from '@rms/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, ListChecks, Send } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

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
import { cashierKeys, cashierRpc, tablesQuery, waitersQuery } from './data';
import { SelectField } from './dialogs';
import { cashierPaths } from './paths';

type OrderType = 'take_away' | 'dine_in';
const orderTypes: readonly OrderType[] = ['take_away', 'dine_in'];

/**
 * New counter order (spec 6.2, plan 4.8 key N): Take Away with the customer's name and phone,
 * or Dine-In for a free table with an optional waiter (create_order p_waiter_id, Cashier and
 * Admin only). The same menu picker and review sheet as the waiter (src/ordering); the cart
 * and its request id stay on the device until the server confirms (BR-15). Totals come from
 * the server only (BR-01).
 */
export function CounterOrder() {
  const { t } = useTranslation(['cashier', 'rpc']);
  const { session } = useAuth();
  const { canSend } = useConnection();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tables = useQuery(tablesQuery);
  const waiters = useQuery(waitersQuery);
  const ids = { name: useId(), phone: useId() };

  const key = draftKey(session?.user.id ?? '', 'counter', null);
  const { draft, count, unavailable } = useCartCheck(key);
  const update = useCartStore((state) => state.update);
  const clear = useCartStore((state) => state.clear);

  const [type, setType] = useState<OrderType>('take_away');
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [tableId, setTableId] = useState('');
  const [waiterId, setWaiterId] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<RpcErrorKey | null>(null);
  const [pending, setPending] = useState(false);
  const sending = useRef(false);

  const free = (tables.data ?? []).filter((row) => row.status === 'available');
  const details = type === 'take_away' ? customerName.trim() !== '' : tableId !== '';
  const canSubmit = canSend && count > 0 && unavailable.size === 0 && details;

  async function send() {
    if (sending.current || !canSubmit) return;
    // Pressed and pending in this frame; a second click is ignored (plan 4.6 rule 1).
    sending.current = true;
    setPending(true);
    setError(null);
    const ready = withRequestId(useCartStore.getState().drafts[key] ?? draft, newRequestId);
    update(key, () => ready);
    const requestId = ready.requestId ?? newRequestId();
    try {
      const order = await cashierRpc.createOrder(
        requestId,
        type === 'take_away'
          ? { type, customerName: customerName.trim(), customerPhone: customerPhone.trim() }
          : { type, tableId, waiterId: waiterId || null },
        toRpcItems(ready),
      );
      await queryClient.refetchQueries({ queryKey: cashierKeys.all });
      clear(key);
      setReviewOpen(false);
      toast.success(t('cashier:counterSent', { number: order.order_number }));
      void navigate(cashierPaths.bill(order.order_id), { replace: true });
    } catch (err) {
      const code = rpcErrorCode(err);
      if (code === 'REQUEST_ID_CONFLICT') {
        update(key, (d) => ({ ...d, requestId: null }));
        void queryClient.invalidateQueries({ queryKey: cashierKeys.all });
      } else if (code === 'ITEM_UNAVAILABLE' || code === 'ITEM_NOT_FOUND') {
        void queryClient.invalidateQueries({ queryKey: menuKey });
      } else if (code === 'TABLE_HAS_OPEN_ORDER') {
        void queryClient.invalidateQueries({ queryKey: cashierKeys.tables });
      }
      setError(rpcErrorKey(err));
    } finally {
      sending.current = false;
      setPending(false);
    }
  }

  const sendButton = (
    <Button size="lg" loading={pending} disabled={!canSubmit} onClick={() => void send()}>
      <Send aria-hidden className="rtl:-scale-x-100" />
      {t('cashier:counterSend')}
    </Button>
  );

  return (
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-4">
      <div className="flex items-center gap-2 py-3">
        <Link
          to={cashierPaths.bills}
          aria-label={t('cashier:back')}
          className="-ms-2 grid size-control-md shrink-0 place-items-center rounded-md hover:bg-surface-2 lg:hidden"
        >
          <ArrowLeft aria-hidden className="size-5 rtl:-scale-x-100" />
        </Link>
        <h2 className="text-2xl font-semibold">{t('cashier:counterTitle')}</h2>
      </div>

      <div className="space-y-3 pb-3">
        <div
          role="radiogroup"
          aria-label={t('cashier:counterType')}
          className="grid grid-cols-2 gap-2"
        >
          {orderTypes.map((option) => (
            <Button
              key={option}
              role="radio"
              aria-checked={type === option}
              variant={type === option ? 'secondary' : 'outline'}
              className={cn(type === option && 'ring-2 ring-brand')}
              onClick={() => {
                setError(null);
                setType(option);
              }}
            >
              {option === 'take_away' ? t('cashier:takeAway') : t('cashier:dineIn')}
            </Button>
          ))}
        </div>
        {type === 'take_away' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={ids.name}>{t('cashier:customerName')}</Label>
              <Input
                id={ids.name}
                required
                maxLength={80}
                autoComplete="off"
                value={customerName}
                onChange={(event) => {
                  setCustomerName(event.target.value);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.phone}>{t('cashier:customerPhone')}</Label>
              <Input
                id={ids.phone}
                type="tel"
                maxLength={30}
                autoComplete="off"
                value={customerPhone}
                onChange={(event) => {
                  setCustomerPhone(event.target.value);
                }}
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label={t('cashier:tableLabel')} value={tableId} onChange={setTableId}>
              <option value="">{t('cashier:chooseTable')}</option>
              {free.map((row) => (
                <option key={row.id} value={row.id}>
                  {t('cashier:table', { number: row.number })}
                </option>
              ))}
            </SelectField>
            <SelectField label={t('cashier:waiterLabel')} value={waiterId} onChange={setWaiterId}>
              <option value="">{t('cashier:noWaiter')}</option>
              {(waiters.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.full_name}
                </option>
              ))}
            </SelectField>
          </div>
        )}
      </div>

      <MenuPicker
        draftKey={key}
        className="top-0"
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
        <div className="flex items-center gap-3 border-t border-border bg-surface/95 px-4 py-3 shadow-md backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {count > 0 ? t('cashier:items', { count }) : t('cashier:noItems')}
            </p>
            <p className="truncate text-sm text-fg-muted">{t('cashier:totalOnSend')}</p>
          </div>
          <Button
            variant="outline"
            size="lg"
            disabled={count === 0}
            onClick={() => {
              setReviewOpen(true);
            }}
          >
            <ListChecks aria-hidden />
            {t('cashier:review')}
          </Button>
          {sendButton}
        </div>
      </div>

      <ReviewSheet
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        title={t('cashier:counterTitle')}
        draftKey={key}
        unavailable={unavailable}
        error={error}
        onEdit={() => {
          setError(null);
        }}
        sendButton={sendButton}
      />
    </div>
  );
}
