import { Button, EmptyState, ErrorState, SkeletonTiles, StatusBadge, cn, toast } from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import { BellRing, LayoutGrid, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { myOrdersQuery, tablesQuery, type MyOrder, type TableRow } from './data';
import { useNow } from './format';
import { OrderAge } from './parts';
import { waiterPaths } from './paths';

const statusBorder: Record<TableRow['status'], string> = {
  available: 'border-s-success',
  occupied: 'border-s-info',
  bill_requested: 'border-s-warning',
};

/** Sections in floor order: by their lowest table number (plan 4.9). */
function bySection(tables: TableRow[]): [string, TableRow[]][] {
  const sections = new Map<string, TableRow[]>();
  for (const table of [...tables].sort((a, b) => a.number - b.number)) {
    const list = sections.get(table.section) ?? [];
    list.push(table);
    sections.set(table.section, list);
  }
  return [...sections.entries()];
}

function TableTile({
  table,
  order,
  now,
}: {
  table: TableRow;
  order: MyOrder | undefined;
  now: number;
}) {
  const { t } = useTranslation(['waiter', 'rpc']);
  // Any waiter may open a free table (Q4); a busy table of another waiter is not theirs.
  const othersTable = table.status !== 'available' && !order;
  const ready = order?.status === 'ready';
  const body = (
    <>
      <span className="flex flex-col">
        <span className="text-3xl leading-none font-bold tabular-nums">
          <span className="sr-only">{t('waiter:table', { number: table.number })} </span>
          <span aria-hidden>{table.number}</span>
        </span>
        <span className="mt-1 text-xs whitespace-nowrap text-fg-muted">
          {t('waiter:seats', { count: table.capacity })}
        </span>
      </span>
      <StatusBadge
        kind="table"
        status={table.status}
        className="h-auto min-h-7 max-w-full self-start py-0.5 text-xs whitespace-normal"
      />
      <span className="flex min-h-5 flex-wrap items-center gap-x-2 text-sm text-fg-muted">
        {order && <OrderAge since={order.created_at} now={now} />}
        {ready && (
          <span className="inline-flex items-center gap-1 font-semibold text-success">
            <BellRing aria-hidden className="size-4" />
            {t('waiter:ready')}
          </span>
        )}
        {othersTable && (
          <span className="inline-flex items-center gap-1">
            <UserRound aria-hidden className="size-4" />
            {t('waiter:otherWaiter')}
          </span>
        )}
      </span>
    </>
  );
  const tile = cn(
    'flex h-full w-full flex-col gap-2 rounded-lg border border-s-4 border-border bg-surface p-3 text-start shadow-sm',
    'transition-colors hover:bg-surface-2',
    statusBorder[table.status],
    othersTable && 'opacity-80',
  );

  if (othersTable) {
    return (
      <button
        type="button"
        className={tile}
        onClick={() => {
          toast(t('waiter:otherWaiterToast', { number: table.number }));
        }}
      >
        {body}
      </button>
    );
  }
  return (
    <Link to={waiterPaths.table(table.id)} className={tile}>
      {body}
    </Link>
  );
}

/** Tables (plan 4.11): grid by section, live status, "My tables" on by default. */
export function TablesScreen() {
  const { t } = useTranslation(['waiter', 'rpc']);
  const tables = useQuery(tablesQuery);
  const orders = useQuery(myOrdersQuery);
  const [mine, setMine] = useState(true);
  const now = useNow();

  const orderByTable = useMemo(
    () => new Map((orders.data ?? []).map((o) => [o.table_id, o] as const)),
    [orders.data],
  );
  const visible = useMemo(
    () =>
      (tables.data ?? []).filter(
        (table) => !mine || table.status === 'available' || orderByTable.has(table.id),
      ),
    [tables.data, mine, orderByTable],
  );

  let content;
  if (tables.isPending || orders.isPending) {
    content = <SkeletonTiles tiles={12} className="mt-4" />;
  } else if (tables.isError || orders.isError) {
    content = (
      <ErrorState
        title={t('waiter:loadFailed')}
        description={t('waiter:loadFailedBody')}
        retryLabel={t('waiter:retry')}
        retrying={tables.isFetching || orders.isFetching}
        onRetry={() => {
          void tables.refetch();
          void orders.refetch();
        }}
      />
    );
  } else if (tables.data.length === 0) {
    content = (
      <EmptyState
        icon={LayoutGrid}
        title={t('waiter:tablesEmpty')}
        description={t('waiter:tablesEmptyBody')}
      />
    );
  } else {
    content = bySection(visible).map(([section, list]) => (
      <section key={section} aria-labelledby={`section-${section}`} className="mt-4">
        <h2 id={`section-${section}`} className="mb-2 text-sm font-semibold text-fg-muted">
          {section}
        </h2>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
          {list.map((table) => (
            <li key={table.id}>
              <TableTile table={table} order={orderByTable.get(table.id)} now={now} />
            </li>
          ))}
        </ul>
      </section>
    ));
  }

  return (
    <div className="pb-6">
      <div className="flex items-center justify-between gap-3 pt-4">
        <h1 className="text-xl font-semibold">{t('waiter:tables')}</h1>
        <Button
          variant={mine ? 'secondary' : 'outline'}
          size="sm"
          aria-pressed={mine}
          title={t('waiter:mineHint')}
          onClick={() => {
            setMine((value) => !value);
          }}
          className={cn('min-h-11', mine && 'ring-2 ring-brand')}
        >
          <UserRound aria-hidden />
          {t('waiter:mine')}
        </Button>
      </div>
      {content}
    </div>
  );
}
