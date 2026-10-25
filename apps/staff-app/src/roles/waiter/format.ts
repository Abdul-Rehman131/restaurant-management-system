import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';

import { tablesQuery } from './data';

/** The current time, updated every `intervalMs` (order ages). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, intervalMs);
    return () => {
      window.clearInterval(timer);
    };
  }, [intervalMs]);
  return now;
}

/** "First send" or "Add-on 2" (BR-06). */
export function batchLabel(t: TFunction<['waiter', 'rpc']>, batchNo: number): string {
  return batchNo === 1 ? t('waiter:firstBatch') : t('waiter:addOnBatch', { batch: batchNo });
}

/** "Table 7" for an alert, from the cached tables (the alert carries ids only). */
export function useTableNumber(): (tableId: string | null) => string {
  const { data } = useQuery(tablesQuery);
  return (tableId) => String(data?.find((row) => row.id === tableId)?.number ?? '');
}
