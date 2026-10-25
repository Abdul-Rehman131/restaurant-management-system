import { EmptyState, ErrorState, MoneyText, SkeletonList, StatusBadge, cn } from '@rms/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleCheck, ReceiptText } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';

import { useRpcAction } from '../../lib/useRpcAction';
import { BillActions, CancelLineButton, VoidPaymentButton } from './BillActions';
import { billQuery, billsQuery, cashierKeys, cashierRpc, type BillDetail as Bill } from './data';
import { useBillName } from './format';
import type { Tender } from './pay';
import { PaymentPad } from './PaymentPad';
import { cashierPaths } from './paths';
import { useCashierStore } from './store';

/** Totals after the subtotal and discount, in bill order: the server's (BR-01, BR-16). */
const totalRows = [
  ['cashier:serviceCharge', 'service_charge'],
  ['cashier:tax', 'tax'],
] as const;

interface Paid {
  orderId: string;
  orderNumber: string;
  change: number;
  completed: boolean;
  tableFree: boolean;
}

function Lines({ bill }: { bill: Bill }) {
  const { t } = useTranslation(['cashier', 'rpc']);
  return (
    <div className="space-y-3">
      {bill.order_batches.map((batch) => (
        <section key={batch.id} aria-labelledby={`batch-${batch.id}`}>
          <h3 id={`batch-${batch.id}`} className="mb-1 text-sm font-semibold text-fg-muted">
            {batch.batch_no === 1
              ? t('cashier:firstBatch')
              : t('cashier:addOnBatch', { batch: batch.batch_no })}
          </h3>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {batch.order_items.map((line) => (
              <li
                key={line.id}
                data-line={line.name_snapshot}
                className={cn(
                  'flex items-start gap-3 px-3 py-2',
                  line.is_cancelled && 'text-fg-muted',
                )}
              >
                <span className="w-8 shrink-0 font-semibold tabular-nums">{line.quantity}×</span>
                <span className="min-w-0 flex-1">
                  <span className={cn(line.is_cancelled && 'line-through')}>
                    {line.name_snapshot}
                  </span>
                  {line.notes && <span className="block text-sm text-fg-muted">{line.notes}</span>}
                  {line.is_cancelled && (
                    <span className="block text-sm font-medium text-danger">
                      {t('cashier:lineCancelled', { reason: line.cancel_reason ?? '' })}
                    </span>
                  )}
                </span>
                <MoneyText
                  amount={line.line_total}
                  className={cn('text-sm', line.is_cancelled && 'line-through')}
                />
                <CancelLineButton line={line} bill={bill} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Totals({ bill }: { bill: Bill }) {
  const { t } = useTranslation(['cashier', 'rpc']);
  return (
    <dl className="space-y-1 rounded-lg bg-surface-2 p-3" aria-label={t('cashier:total')}>
      <div className="flex justify-between gap-3 text-fg-muted">
        <dt>{t('cashier:subtotal')}</dt>
        <dd>
          <MoneyText amount={bill.subtotal} />
        </dd>
      </div>
      {bill.discount > 0 && (
        <div className="flex justify-between gap-3 text-fg-muted">
          <dt>
            {t('cashier:discount')}
            {bill.discount_reason && (
              <span className="block text-xs">
                {t('cashier:discountReason', { reason: bill.discount_reason })}
              </span>
            )}
          </dt>
          <dd>
            −<MoneyText amount={bill.discount} />
          </dd>
        </div>
      )}
      {totalRows
        // No service charge on Take Away (BR-16): the row is left out, as on the receipt.
        .filter(([, field]) => field !== 'service_charge' || bill.service_charge > 0)
        .map(([label, field]) => (
          <div key={label} className="flex justify-between gap-3 text-fg-muted">
            <dt>{t(label)}</dt>
            <dd>
              <MoneyText amount={bill[field]} />
            </dd>
          </div>
        ))}
      <div className="flex justify-between gap-3 border-t border-border pt-2 text-xl font-bold">
        <dt>{t('cashier:total')}</dt>
        <dd>
          <MoneyText amount={bill.total} data-testid="bill-total" />
        </dd>
      </div>
    </dl>
  );
}

function Payments({ bill }: { bill: Bill }) {
  const { t } = useTranslation(['cashier', 'rpc']);
  if (bill.payments.length === 0) return null;
  return (
    <section aria-labelledby="payments-heading" className="space-y-2">
      <h3 id="payments-heading" className="text-sm font-semibold text-fg-muted">
        {t('cashier:payments')}
      </h3>
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {bill.payments.map((p) => (
          <li
            key={p.id}
            data-payment={p.method}
            className={cn(
              'flex items-center justify-between gap-3 px-3 py-2',
              p.voided_at && 'text-fg-muted',
            )}
          >
            <span>
              <span className={cn(p.voided_at && 'line-through')}>{t(`cashier:${p.method}`)}</span>
              {p.reference && <span className="ms-2 text-sm text-fg-muted">{p.reference}</span>}
              {p.voided_at && (
                <span className="block text-sm text-danger">
                  {t('cashier:voided', { reason: p.void_reason ?? '' })}
                </span>
              )}
            </span>
            <span className="flex items-center gap-2">
              <MoneyText amount={p.amount} className={cn(p.voided_at && 'line-through')} />
              <VoidPaymentButton payment={p} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One bill (plan 4.9, 4.11): who it is for, the lines by batch with notes and cancelled
 * lines, the totals exactly as the server has them, the payments, and the payment pad while
 * something is due. After a payment: a confirmation with the change from the server.
 */
export function BillDetail() {
  const { t } = useTranslation(['cashier', 'rpc']);
  const { orderId = '' } = useParams();
  const queryClient = useQueryClient();
  const bill = useQuery(billQuery(orderId));
  const openBill = useQuery({
    ...billsQuery,
    select: (bills) => bills.find((b) => b.order_id === orderId) ?? null,
  });
  const billName = useBillName();
  const markRequestRead = useCashierStore((s) => s.markRequestRead);
  const [lastPaid, setPaid] = useState<Paid | null>(null);
  // The confirmation belongs to the bill it was paid on.
  const paid = lastPaid?.orderId === orderId ? lastPaid : null;

  useEffect(() => {
    markRequestRead(orderId);
  }, [orderId, markRequestRead]);

  const payment = useRpcAction(
    useCallback(
      (requestId: string, tenders: Tender[]) =>
        cashierRpc.recordPayment(requestId, orderId, tenders),
      [orderId],
    ),
    useCallback(
      async (result: Awaited<ReturnType<typeof cashierRpc.recordPayment>>) => {
        setPaid({
          orderId: result.order_id,
          orderNumber: result.order_number,
          change: result.change_due,
          completed: result.status === 'completed',
          tableFree: result.table_status === 'available',
        });
        // Shown only as the server has it (hard rule 9).
        await queryClient.refetchQueries({ queryKey: cashierKeys.all });
      },
      [queryClient],
    ),
  );

  if (bill.isPending) return <SkeletonList rows={6} className="p-6" />;
  if (bill.isError && !bill.data) {
    return (
      <ErrorState
        title={t('cashier:loadFailed')}
        description={t('cashier:loadFailedBody')}
        retryLabel={t('cashier:retry')}
        onRetry={() => void bill.refetch()}
      />
    );
  }
  const detail = bill.data;
  if (!detail) {
    return (
      <EmptyState
        icon={ReceiptText}
        title={t('cashier:billGone')}
        description={t('cashier:billGoneBody')}
        className="h-full justify-center"
      />
    );
  }
  const name = billName({
    table_number: detail.table?.number ?? null,
    customer_name: detail.customer_name,
  });
  const due = openBill.data?.due ?? 0;
  const payable =
    detail.payment_status === 'unpaid' && detail.status !== 'cancelled' && due > 0 && !paid;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex items-start gap-3">
        <Link
          to={cashierPaths.bills}
          aria-label={t('cashier:back')}
          className="-ms-2 grid size-control-md shrink-0 place-items-center rounded-md hover:bg-surface-2 lg:hidden"
        >
          <ArrowLeft aria-hidden className="size-5 rtl:-scale-x-100" />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-semibold">{name}</h2>
          <p className="text-sm text-fg-muted">
            {detail.order_number}
            {detail.waiter && ` · ${t('cashier:waiter', { name: detail.waiter.full_name })}`}
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          {detail.bill_requested && <StatusBadge kind="table" status="bill_requested" />}
          <StatusBadge kind="order" status={detail.status} />
          <StatusBadge kind="payment" status={detail.payment_status} />
        </div>
      </div>

      <Lines bill={detail} />
      <Totals bill={detail} />
      <Payments bill={detail} />
      <BillActions bill={detail} name={name} />

      {paid && (
        <section
          role="status"
          className="space-y-2 rounded-lg border border-success/40 bg-success-bg p-4 text-success"
        >
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <CircleCheck aria-hidden className="size-5" />
            {t('cashier:paidTitle')}
          </h3>
          <p>{t('cashier:paidBody', { number: paid.orderNumber })}</p>
          {paid.change > 0 && (
            <p className="flex items-baseline justify-between gap-3">
              <span className="font-semibold">{t('cashier:changeDue')}</span>
              <MoneyText amount={paid.change} fraction="always" className="text-3xl font-bold" />
            </p>
          )}
          <p>
            {paid.completed ? t('cashier:completed') : t('cashier:awaitingFulfilment')}
            {paid.tableFree && ` ${t('cashier:tableFree')}`}
          </p>
        </section>
      )}

      {payable && <PaymentPad key={`${detail.id}-${String(due)}`} due={due} action={payment} />}
    </div>
  );
}
