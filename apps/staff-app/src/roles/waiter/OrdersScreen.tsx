import { EmptyState, ErrorState, MoneyText, SkeletonList, StatusBadge } from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ClipboardList } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { myOrdersQuery, tablesQuery } from './data';
import { useNow } from './format';
import { OrderAge } from './parts';
import { waiterPaths } from './paths';

/** Orders tab: my open orders, oldest first, with status, bill request and age. */
export function OrdersScreen() {
  const { t } = useTranslation(['waiter', 'rpc']);
  const orders = useQuery(myOrdersQuery);
  const tables = useQuery(tablesQuery);
  const now = useNow();
  const tableNumber = useMemo(
    () => new Map((tables.data ?? []).map((row) => [row.id, row.number] as const)),
    [tables.data],
  );

  let content;
  if (orders.isPending) {
    content = <SkeletonList rows={4} className="mt-4" />;
  } else if (orders.isError) {
    content = (
      <ErrorState
        title={t('waiter:loadFailed')}
        description={t('waiter:loadFailedBody')}
        retryLabel={t('waiter:retry')}
        onRetry={() => void orders.refetch()}
      />
    );
  } else if (orders.data.length === 0) {
    content = (
      <EmptyState
        icon={ClipboardList}
        title={t('waiter:ordersEmpty')}
        description={t('waiter:ordersEmptyBody')}
      />
    );
  } else {
    content = (
      <ul className="mt-4 space-y-3">
        {orders.data.map((order) => {
          if (!order.table_id) return null;
          return (
            <li key={order.id}>
              <Link
                to={waiterPaths.table(order.table_id)}
                className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-lg font-semibold">
                      {t('waiter:table', { number: tableNumber.get(order.table_id) ?? '' })}
                    </span>
                    <MoneyText amount={order.total} className="text-sm font-semibold" />
                  </span>
                  <span className="block text-sm text-fg-muted">
                    {order.order_number} · <OrderAge since={order.created_at} now={now} />
                  </span>
                  <span className="flex flex-wrap gap-2">
                    <StatusBadge kind="order" status={order.status} />
                    {order.bill_requested && <StatusBadge kind="table" status="bill_requested" />}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className="size-5 shrink-0 text-fg-muted rtl:-scale-x-100"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="pt-4 pb-6">
      <h1 className="text-xl font-semibold">{t('waiter:orders')}</h1>
      {content}
    </div>
  );
}
