import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router';

/** The open bill (filled in by the next S4 step). */
export function BillDetail() {
  const { t } = useTranslation(['cashier', 'rpc']);
  const { orderId } = useParams();
  return <p className="p-6 text-fg-muted">{orderId ? t('cashier:detailEmptyBody') : null}</p>;
}
