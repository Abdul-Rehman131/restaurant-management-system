import { useTranslation } from 'react-i18next';

/** "Table 7" or "Take Away · Ali": who the bill is for. */
export function useBillName(): (bill: {
  table_number: number | null;
  customer_name: string | null;
}) => string {
  const { t } = useTranslation(['cashier', 'rpc']);
  return (bill) =>
    bill.table_number !== null
      ? t('cashier:table', { number: bill.table_number })
      : bill.customer_name
        ? t('cashier:takeAwayFor', { name: bill.customer_name })
        : t('cashier:takeAway');
}
