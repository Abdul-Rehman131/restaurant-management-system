import {
  Button,
  MoneyText,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  StatusBadge,
  cn,
  toast,
} from '@rms/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  CircleAlert,
  Info,
  Plus,
  ReceiptText,
  UtensilsCrossed,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { useRpcAction } from '../../lib/useRpcAction';
import { useConnection } from '../../shell/connection-context';
import { tablesQuery, waiterKeys, waiterRpc, type MyOrder, type TableRow } from './data';
import { batchLabel } from './format';
import { BatchBadge, ScreenTitle } from './parts';
import { waiterPaths } from './paths';

/** The totals block, in bill order: every amount is the server's (BR-01, BR-16). */
const totalRows = [
  ['waiter.subtotal', 'subtotal'],
  ['waiter.serviceCharge', 'service_charge'],
  ['waiter.tax', 'tax'],
] as const;

/** Statuses in which a bill can be requested (request_bill: not Pending, not closed). */
const billable = new Set<MyOrder['status']>(['accepted', 'preparing', 'ready', 'served']);

function MoveTableSheet({
  open,
  onOpenChange,
  order,
  table,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: MyOrder;
  table: TableRow;
}) {
  const { t } = useTranslation();
  const { canSend } = useConnection();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const tables = useQuery(tablesQuery);
  const free = (tables.data ?? []).filter(
    (row) => row.status === 'available' && row.id !== table.id,
  );
  const move = useRpcAction(
    waiterRpc.moveTable,
    useCallback(
      async (result: Awaited<ReturnType<typeof waiterRpc.moveTable>>) => {
        await queryClient.refetchQueries({ queryKey: waiterKeys.all });
        const to = queryClient
          .getQueryData<TableRow[]>(waiterKeys.tables)
          ?.find((row) => row.id === result.table_id);
        toast.success(t('waiter.moved', { number: to?.number ?? '' }));
        if (result.table_id) void navigate(waiterPaths.table(result.table_id), { replace: true });
      },
      [queryClient, navigate, t],
    ),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="auto">
        <SheetHeader>
          <SheetTitle>{t('waiter.moveTitle')}</SheetTitle>
          <SheetDescription>{t('waiter.moveDescription')}</SheetDescription>
        </SheetHeader>
        {free.length === 0 ? (
          <p className="py-4 text-center text-fg-muted">{t('waiter.moveNoFree')}</p>
        ) : (
          <ul className="grid grid-cols-3 gap-3">
            {free.map((row) => (
              <li key={row.id}>
                <Button
                  variant="outline"
                  size="lg"
                  className="w-full"
                  disabled={!canSend || move.pending}
                  onClick={() => void move.run(order.id, row.id)}
                >
                  {t('waiter.table', { number: row.number })}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {move.error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-danger-bg p-3 text-danger"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
            {t(move.error)}
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * My open order on a table (spec 6.1 steps 4 to 6): the sent batches with their kitchen
 * status, the server's totals, Add more items (a new batch, BR-06), Mark Served, Request
 * Bill and Move table. Waiters cannot cancel sent lines (BR-09): the cashier does.
 */
export function OrderDetail({ table, order }: { table: TableRow; order: MyOrder }) {
  const { t } = useTranslation();
  const { canSend } = useConnection();
  const queryClient = useQueryClient();
  const [moving, setMoving] = useState(false);

  // The screen changes only when the server's data says so (hard rule 9).
  const refetch = useCallback(
    () => queryClient.refetchQueries({ queryKey: waiterKeys.all }),
    [queryClient],
  );
  const served = useRpcAction(
    waiterRpc.markServed,
    useCallback(async () => {
      await refetch();
      toast.success(t('waiter.servedToast', { number: table.number }));
    }, [refetch, t, table.number]),
  );
  const bill = useRpcAction(
    waiterRpc.requestBill,
    useCallback(async () => {
      await refetch();
      toast.success(t('waiter.billToast', { number: table.number }));
    }, [refetch, t, table.number]),
  );
  const error = served.error ?? bill.error;
  const paid = order.payment_status === 'paid';

  return (
    <>
      <ScreenTitle
        back={waiterPaths.tables}
        title={t('waiter.table', { number: table.number })}
        subtitle={order.order_number}
      >
        <StatusBadge kind="order" status={order.status} />
      </ScreenTitle>

      <div className="flex flex-wrap gap-2">
        {order.bill_requested && <StatusBadge kind="table" status="bill_requested" />}
        {paid && <StatusBadge kind="payment" status="paid" />}
      </div>

      <div className="flex-1 space-y-4 pt-3 pb-4">
        {order.order_batches.map((batch) => (
          <section
            key={batch.id}
            aria-labelledby={`batch-${batch.id}`}
            className="rounded-lg border border-border bg-surface p-3 shadow-sm"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 id={`batch-${batch.id}`} className="font-semibold">
                {batchLabel(t, batch.batch_no)}
              </h2>
              <BatchBadge status={batch.status} />
            </div>
            <ul className="mt-2 divide-y divide-border">
              {batch.order_items.map((line) => (
                <li
                  key={line.id}
                  className={cn(
                    'flex items-start gap-3 py-2',
                    line.is_cancelled && 'text-fg-muted',
                  )}
                >
                  <span className="w-8 shrink-0 font-semibold tabular-nums">{line.quantity}×</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn(line.is_cancelled && 'line-through')}>
                      {line.name_snapshot}
                    </span>
                    {line.notes && (
                      <span className="block text-sm text-fg-muted">{line.notes}</span>
                    )}
                    {line.is_cancelled && (
                      <span className="block text-sm font-medium text-danger">
                        {t('waiter.lineCancelled')}
                      </span>
                    )}
                    {!line.needs_kitchen && !line.is_cancelled && (
                      <span className="block text-sm text-fg-muted">{t('waiter.noKitchen')}</span>
                    )}
                  </span>
                  <MoneyText
                    amount={line.line_total}
                    className={cn('text-sm', line.is_cancelled && 'line-through')}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {/* Server totals only (BR-01, BR-16): nothing is added up on the device. */}
        <dl className="space-y-1 rounded-lg bg-surface-2 p-3">
          {totalRows.map(([label, field]) => (
            <div key={label} className="flex justify-between gap-3 text-fg-muted">
              <dt>{t(label)}</dt>
              <dd>
                <MoneyText amount={order[field]} />
              </dd>
            </div>
          ))}
          {order.discount > 0 && (
            <div className="flex justify-between gap-3 text-fg-muted">
              <dt>{t('waiter.discount')}</dt>
              <dd>
                −<MoneyText amount={order.discount} />
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3 border-t border-border pt-2 text-lg font-semibold">
            <dt>{t('waiter.total')}</dt>
            <dd>
              <MoneyText amount={order.total} />
            </dd>
          </div>
        </dl>

        <p className="flex items-start gap-2 text-sm text-fg-muted">
          <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
          {t('waiter.cancelHint')}
        </p>
        <Button
          variant="ghost"
          className="-ms-3"
          disabled={!canSend}
          onClick={() => {
            setMoving(true);
          }}
        >
          <ArrowRightLeft aria-hidden />
          {t('waiter.moveTable')}
        </Button>
      </div>

      <div className="sticky bottom-0 z-30 -mx-4 border-t border-border bg-surface/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-md backdrop-blur">
        {error && (
          <p
            role="alert"
            className="mb-3 flex items-start gap-2 rounded-md bg-danger-bg p-3 text-danger"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
            {t(error)}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          {order.status === 'ready' ? (
            <Button
              size="lg"
              loading={served.pending}
              disabled={!canSend}
              onClick={() => void served.run(order.id)}
            >
              <UtensilsCrossed aria-hidden />
              {t('waiter.markServed')}
            </Button>
          ) : (
            <Button
              variant="outline"
              size="lg"
              loading={bill.pending}
              disabled={!canSend || paid || order.bill_requested || !billable.has(order.status)}
              onClick={() => void bill.run(order.id)}
            >
              <ReceiptText aria-hidden />
              {order.bill_requested ? t('waiter.billRequested') : t('waiter.requestBill')}
            </Button>
          )}
          {paid ? (
            <Button size="lg" disabled>
              <Plus aria-hidden />
              {t('waiter.addMore')}
            </Button>
          ) : (
            <Button asChild size="lg" variant={order.status === 'ready' ? 'outline' : 'primary'}>
              <Link to={waiterPaths.addItems(table.id)}>
                <Plus aria-hidden />
                {t('waiter.addMore')}
              </Link>
            </Button>
          )}
        </div>
        {order.status === 'ready' && (
          <Button
            variant="ghost"
            className="mt-2 w-full"
            loading={bill.pending}
            disabled={!canSend || paid || order.bill_requested}
            onClick={() => void bill.run(order.id)}
          >
            <ReceiptText aria-hidden />
            {order.bill_requested ? t('waiter.billRequested') : t('waiter.requestBill')}
          </Button>
        )}
      </div>

      <MoveTableSheet open={moving} onOpenChange={setMoving} order={order} table={table} />
    </>
  );
}
