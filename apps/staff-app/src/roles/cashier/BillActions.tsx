import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@rms/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  Ban,
  BadgePercent,
  Info,
  PackageCheck,
  ReceiptText,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuth } from '../../auth/auth-context';
import { useRpcAction } from '../../lib/useRpcAction';
import { useConnection } from '../../shell/connection-context';
import {
  cashierKeys,
  cashierRpc,
  tablesQuery,
  waitersQuery,
  type BillDetail,
  type BillLine,
  type BillPayment,
} from './data';
import { DiscountDialog, ReasonDialog, SelectField } from './dialogs';

/** Statuses an order can still be cancelled from as a whole (S1, spec 6.4). */
const cancellable = new Set<BillDetail['status']>(['pending', 'accepted', 'preparing']);
const open = new Set<BillDetail['status']>(['pending', 'accepted', 'preparing', 'ready', 'served']);

function useRefetch() {
  const queryClient = useQueryClient();
  // The screen changes only when the server's data says so (hard rule 9).
  return useCallback(
    () => queryClient.refetchQueries({ queryKey: cashierKeys.all }),
    [queryClient],
  );
}

/** Cancel one line after it was sent (BR-09): Cashier and Admin, with a reason. */
export function CancelLineButton({ line, bill }: { line: BillLine; bill: BillDetail }) {
  const { t } = useTranslation(['cashier', 'rpc']);
  const { canSend } = useConnection();
  const refetch = useRefetch();
  const [asking, setAsking] = useState(false);
  const action = useRpcAction(cashierRpc.cancelItem, refetch);
  if (line.is_cancelled || bill.payment_status === 'paid' || !open.has(bill.status)) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="-my-2 text-danger"
        disabled={!canSend}
        aria-label={t('cashier:cancelLine', { item: line.name_snapshot })}
        onClick={() => {
          setAsking(true);
        }}
      >
        <X aria-hidden />
      </Button>
      <ReasonDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('cashier:cancelLineTitle', { item: line.name_snapshot })}
        description={t('cashier:cancelLineBody')}
        confirmLabel={t('cashier:confirmCancel')}
        pending={action.pending}
        error={action.error}
        onConfirm={(reason) => action.run(line.id, reason)}
      />
    </>
  );
}

/** Void one payment (G8): Admin only, with a reason; the order opens for payment again. */
export function VoidPaymentButton({ payment }: { payment: BillPayment }) {
  const { t } = useTranslation(['cashier', 'rpc']);
  const { role } = useAuth();
  const { canSend } = useConnection();
  const refetch = useRefetch();
  const [asking, setAsking] = useState(false);
  const action = useRpcAction(
    cashierRpc.voidPayment,
    useCallback(async () => {
      await refetch();
      toast.success(t('cashier:voidToast'));
    }, [refetch, t]),
  );
  if (role !== 'admin' || payment.voided_at) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-danger"
        disabled={!canSend}
        onClick={() => {
          setAsking(true);
        }}
      >
        <Ban aria-hidden />
        {t('cashier:voidPayment')}
      </Button>
      <ReasonDialog
        open={asking}
        onOpenChange={setAsking}
        title={t('cashier:voidTitle')}
        description={t('cashier:voidBody')}
        confirmLabel={t('cashier:voidPayment')}
        pending={action.pending}
        error={action.error}
        onConfirm={(reason) => action.run(payment.id, reason)}
      />
    </>
  );
}

function MoveDialog({
  open: isOpen,
  onOpenChange,
  bill,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bill: BillDetail;
}) {
  const { t } = useTranslation(['cashier', 'rpc']);
  const { canSend } = useConnection();
  const refetch = useRefetch();
  const tables = useQuery({ ...tablesQuery, enabled: isOpen });
  const waiters = useQuery({ ...waitersQuery, enabled: isOpen });
  const [tableId, setTableId] = useState('');
  const [waiterId, setWaiterId] = useState('');
  const action = useRpcAction(
    cashierRpc.move,
    useCallback(async () => {
      await refetch();
      toast.success(t('cashier:movedToast', { bill: bill.order_number }));
      onOpenChange(false);
    }, [refetch, t, bill.order_number, onOpenChange]),
  );
  const free = (tables.data ?? []).filter((row) => row.status === 'available');
  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('cashier:moveTitle')}</DialogTitle>
          <DialogDescription>{t('cashier:moveDescription')}</DialogDescription>
        </DialogHeader>
        <SelectField label={t('cashier:moveTableLabel')} value={tableId} onChange={setTableId}>
          <option value="">{t('cashier:moveKeep')}</option>
          {free.map((row) => (
            <option key={row.id} value={row.id}>
              {t('cashier:table', { number: row.number })}
            </option>
          ))}
        </SelectField>
        <SelectField label={t('cashier:moveWaiterLabel')} value={waiterId} onChange={setWaiterId}>
          <option value="">{t('cashier:moveWaiterKeep')}</option>
          {(waiters.data ?? [])
            .filter((w) => w.id !== bill.waiter_id)
            .map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name}
              </option>
            ))}
        </SelectField>
        {action.error && (
          <p role="alert" className="text-danger">
            {t(action.error)}
          </p>
        )}
        <DialogFooter>
          <Button
            loading={action.pending}
            disabled={!canSend || (!tableId && !waiterId)}
            onClick={() => void action.run(bill.id, tableId || null, waiterId || null)}
          >
            <ArrowRightLeft aria-hidden />
            {t('cashier:moveSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What the cashier can do with an open bill besides paying (spec 4, 6.1, 6.2): Mark served,
 * Request bill, Hand over a Ready Take Away, move the table or the waiter, cancel the order
 * with a reason, and for an Admin a discount. The database checks every role again.
 */
export function BillActions({ bill, name }: { bill: BillDetail; name: string }) {
  const { t } = useTranslation(['cashier', 'rpc']);
  const { role } = useAuth();
  const { canSend } = useConnection();
  const refetch = useRefetch();
  const [moving, setMoving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [discounting, setDiscounting] = useState(false);
  const toastAfter = (message: string) => async () => {
    await refetch();
    toast.success(message);
  };
  const served = useRpcAction(
    cashierRpc.setStatus,
    toastAfter(t('cashier:servedToast', { bill: name })),
  );
  const handover = useRpcAction(
    cashierRpc.setStatus,
    toastAfter(t('cashier:handoverToast', { bill: name })),
  );
  const billRequest = useRpcAction(
    cashierRpc.requestBill,
    toastAfter(t('cashier:billToast', { bill: name })),
  );
  const cancel = useRpcAction(cashierRpc.cancelOrder, toastAfter(t('cashier:cancelledToast')));
  const discount = useRpcAction(cashierRpc.applyDiscount, toastAfter(t('cashier:discountToast')));

  if (!open.has(bill.status)) return null;
  const unpaid = bill.payment_status === 'unpaid';
  const error = served.error ?? handover.error ?? billRequest.error;

  return (
    <section aria-label={t('cashier:actions')} className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {bill.type === 'dine_in' && bill.status === 'ready' && (
          <Button
            variant="outline"
            loading={served.pending}
            disabled={!canSend}
            onClick={() => void served.run(bill.id, 'served')}
          >
            <UtensilsCrossed aria-hidden />
            {t('cashier:markServed')}
          </Button>
        )}
        {bill.type === 'take_away' && bill.status === 'ready' && bill.payment_status === 'paid' && (
          <Button
            loading={handover.pending}
            disabled={!canSend}
            onClick={() => void handover.run(bill.id, 'completed')}
          >
            <PackageCheck aria-hidden />
            {t('cashier:handover')}
          </Button>
        )}
        {unpaid && !bill.bill_requested && bill.status !== 'pending' && (
          <Button
            variant="outline"
            loading={billRequest.pending}
            disabled={!canSend}
            onClick={() => void billRequest.run(bill.id)}
          >
            <ReceiptText aria-hidden />
            {t('cashier:requestBill')}
          </Button>
        )}
        {bill.type === 'dine_in' && (
          <Button
            variant="outline"
            disabled={!canSend}
            onClick={() => {
              setMoving(true);
            }}
          >
            <ArrowRightLeft aria-hidden />
            {t('cashier:moveTable')}
          </Button>
        )}
        {role === 'admin' && unpaid && (
          <Button
            variant="outline"
            disabled={!canSend}
            onClick={() => {
              setDiscounting(true);
            }}
          >
            <BadgePercent aria-hidden />
            {t('cashier:discount_action')}
          </Button>
        )}
        {unpaid && cancellable.has(bill.status) && (
          <Button
            variant="outline"
            className="text-danger"
            disabled={!canSend}
            onClick={() => {
              setCancelling(true);
            }}
          >
            <Ban aria-hidden />
            {t('cashier:cancelOrder')}
          </Button>
        )}
      </div>
      {role !== 'admin' && (
        <p className="flex items-start gap-2 text-sm text-fg-muted">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('cashier:adminOnlyHint')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {t(error)}
        </p>
      )}

      <MoveDialog open={moving} onOpenChange={setMoving} bill={bill} />
      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={t('cashier:cancelOrderTitle', { bill: name })}
        description={t('cashier:cancelOrderBody')}
        confirmLabel={t('cashier:confirmCancel')}
        pending={cancel.pending}
        error={cancel.error}
        onConfirm={(reason) => cancel.run(bill.id, reason)}
      />
      <DiscountDialog
        open={discounting}
        onOpenChange={setDiscounting}
        title={t('cashier:discountTitle', { bill: name })}
        pending={discount.pending}
        error={discount.error}
        onConfirm={(amount, reason) => discount.run(bill.id, amount, reason)}
      />
    </section>
  );
}
