import { EmptyState, ErrorState, SkeletonList } from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Navigate, useParams } from 'react-router';

import { myOrdersQuery, tablesQuery } from './data';
import { OrderDetail } from './OrderDetail';
import { OrderEntry } from './OrderEntry';
import { ScreenTitle } from './parts';
import { waiterPaths } from './paths';

/**
 * /waiter/table/:id: my open order on the table (its detail, or Add more items), else order
 * entry for a free table. Another waiter's busy table is not mine to open.
 */
export function TableRoute({ adding }: { adding: boolean }) {
  const { t } = useTranslation(['waiter', 'rpc']);
  const { tableId } = useParams();
  const tables = useQuery(tablesQuery);
  const orders = useQuery(myOrdersQuery);

  if (tables.isPending || orders.isPending) return <SkeletonList rows={6} className="mt-6" />;
  if (tables.isError || orders.isError) {
    return (
      <ErrorState
        title={t('waiter:loadFailed')}
        description={t('waiter:loadFailedBody')}
        retryLabel={t('waiter:retry')}
        onRetry={() => {
          void tables.refetch();
          void orders.refetch();
        }}
      />
    );
  }

  const table = tables.data.find((row) => row.id === tableId);
  if (!table) return <Navigate to={waiterPaths.tables} replace />;
  const order = orders.data.find((row) => row.table_id === table.id) ?? null;

  if (order) {
    return adding ? (
      <OrderEntry table={table} order={order} />
    ) : (
      <OrderDetail table={table} order={order} />
    );
  }
  if (table.status === 'available') {
    // After the order closes (paid and served), the add-items URL is a new order again.
    return adding ? (
      <Navigate to={waiterPaths.table(table.id)} replace />
    ) : (
      <OrderEntry table={table} order={null} />
    );
  }
  return (
    <>
      <ScreenTitle back={waiterPaths.tables} title={t('waiter:table', { number: table.number })} />
      <EmptyState
        icon={UserRound}
        title={t('waiter:notYoursTitle', { number: table.number })}
        description={t('waiter:notYoursBody')}
      />
    </>
  );
}
