import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';

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
export function batchLabel(t: TFunction, batchNo: number): string {
  return batchNo === 1 ? t('waiter.firstBatch') : t('waiter.addOnBatch', { batch: batchNo });
}
