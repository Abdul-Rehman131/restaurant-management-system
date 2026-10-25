import { EmptyState, ErrorState, Input, MoneyText, SkeletonList, StatusBadge, cn } from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import { ReceiptText, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { Bill } from './bills';
import { billsQuery } from './data';
import { useBillName } from './format';
import { cashierPaths } from './paths';
import { useCashierStore } from './store';

const normalize = (text: string) => text.toLocaleLowerCase().normalize('NFKD');

/**
 * Open bills (plan 4.5, 4.11): Bill Requested first, then Ready Take Away, then by age, from
 * get_open_bills (server totals and amounts due). "/" focuses the search; the arrow keys
 * move through the rows and Enter opens one (plan 4.8).
 */
export function BillList({ selectedId }: { selectedId: string | null }) {
  const { t } = useTranslation(['cashier', 'rpc']);
  const bills = useQuery(billsQuery);
  const billName = useBillName();
  const unread = useCashierStore((s) => s.unreadRequests);
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const words = normalize(query.trim());
    const list = bills.data ?? [];
    if (!words) return list;
    return list.filter((bill) =>
      normalize(`${billName(bill)} ${bill.order_number} ${bill.waiter_name ?? ''}`).includes(words),
    );
    // billName only formats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bills.data, query]);

  let content;
  if (bills.isPending) {
    content = <SkeletonList rows={6} className="p-4" />;
  } else if (bills.isError && !bills.data) {
    content = (
      <ErrorState
        title={t('cashier:loadFailed')}
        description={t('cashier:loadFailedBody')}
        retryLabel={t('cashier:retry')}
        retrying={bills.isFetching}
        onRetry={() => void bills.refetch()}
      />
    );
  } else if (bills.data.length === 0) {
    content = (
      <EmptyState
        icon={ReceiptText}
        title={t('cashier:billsEmpty')}
        description={t('cashier:billsEmptyBody')}
      />
    );
  } else if (shown.length === 0) {
    content = (
      <p className="p-6 text-center text-fg-muted">{t('cashier:noBillMatches', { query })}</p>
    );
  } else {
    content = (
      <ul className="divide-y divide-border">
        {shown.map((bill: Bill) => (
          <li key={bill.order_id}>
            <Link
              to={cashierPaths.bill(bill.order_id)}
              data-bill-row
              aria-current={bill.order_id === selectedId ? 'page' : undefined}
              className={cn(
                'flex min-h-16 flex-col gap-1.5 px-4 py-3 hover:bg-surface-2 focus-visible:-outline-offset-2',
                bill.order_id === selectedId && 'bg-surface-2 shadow-[inset_4px_0_0] shadow-brand',
              )}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2 truncate font-semibold">
                  {billName(bill)}
                  {unread.has(bill.order_id) && (
                    <span className="size-2.5 shrink-0 rounded-full bg-accent" aria-hidden />
                  )}
                </span>
                <MoneyText amount={bill.total} className="font-semibold" />
              </span>
              <span className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                <span>{bill.order_number}</span>
                {bill.waiter_name && (
                  <span>· {t('cashier:waiter', { name: bill.waiter_name })}</span>
                )}
              </span>
              <span className="flex flex-wrap gap-1.5">
                {bill.bill_requested && <StatusBadge kind="table" status="bill_requested" />}
                <StatusBadge kind="order" status={bill.status} />
                {bill.payment_status === 'paid' && <StatusBadge kind="payment" status="paid" />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <div className="border-b border-border p-3">
        <label className="relative block">
          <span className="sr-only">{t('cashier:searchBills')}</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted"
          />
          <Input
            id="cashier-search"
            type="search"
            value={query}
            placeholder={t('cashier:searchBillsPlaceholder')}
            aria-keyshortcuts="/"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className="ps-10"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
    </>
  );
}
