import { Button } from '@rms/ui';
import { Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { MyOrder, TableRow } from './data';
import { ScreenTitle } from './parts';
import { waiterPaths } from './paths';

/** My open order on a table (the full detail screen follows in the next step). */
export function OrderDetail({ table, order }: { table: TableRow; order: MyOrder }) {
  const { t } = useTranslation();
  return (
    <>
      <ScreenTitle
        back={waiterPaths.tables}
        title={t('waiter.table', { number: table.number })}
        subtitle={order.order_number}
      />
      <Button asChild size="lg">
        <Link to={waiterPaths.addItems(table.id)}>
          <Plus aria-hidden />
          {t('waiter.addMore')}
        </Link>
      </Button>
    </>
  );
}
