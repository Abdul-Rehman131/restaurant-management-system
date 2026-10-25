import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ticketLabel, type Ticket } from './queue';

/** The device time, updated every `intervalMs` (ticket ages). */
export function useNow(intervalMs: number): number {
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

/** "T7", "Ali" or the order number: what the kitchen calls out. */
export function useTicketName(): (ticket: Ticket) => string {
  const { t } = useTranslation(['kitchen', 'rpc']);
  return (ticket) => {
    const label = ticketLabel(ticket);
    if (label.kind === 'table') return t('kitchen:table', { number: label.table });
    if (label.kind === 'customer') return label.name;
    return label.orderNumber;
  };
}
