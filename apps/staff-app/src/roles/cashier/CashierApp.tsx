// Loaded only inside the signed-in shell: importing it ties the shell's modules (data
// client, TanStack Query, settings) to the shell chunk instead of splitting them into shared
// chunks the shell would download as extra files (plan 4.10 budgets).
import '../../shell/SignedIn';

import { Button, EmptyState, OfflineBanner } from '@rms/ui';
import { MousePointerClick, Plus, ReceiptText } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { useConnection } from '../../shell/connection-context';
import { StaffHeader } from '../../shell/StaffHeader';
import { useScreenAppearance } from '../../shell/theme-context';
import { useComingSoon } from '../../shell/useComingSoon';

/**
 * Cashier: desk density, split screen from lg (38% open bills, 62% bill detail and payment).
 * Under lg it is the list, then the detail with a back button (plan 4.5).
 */
export function CashierApp() {
  const { t } = useTranslation();
  const { state, canSend } = useConnection();
  const comingSoon = useComingSoon();
  const billsId = useId();
  useScreenAppearance({ density: 'desk' });

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <StaffHeader
        actions={
          <Button disabled={!canSend} onClick={comingSoon} className="hidden sm:inline-flex">
            <Plus aria-hidden />
            {t('cashier.newCounterOrder')}
          </Button>
        }
      />
      <OfflineBanner online={state !== 'offline'} />
      <h1 className="sr-only">{t('cashier.title')}</h1>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[38fr_62fr]">
        <section
          aria-labelledby={billsId}
          className="flex min-h-0 flex-col border-border bg-surface lg:border-e"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 id={billsId} className="text-lg font-semibold">
              {t('cashier.openBills')}
            </h2>
            <Button
              size="sm"
              disabled={!canSend}
              onClick={comingSoon}
              className="sm:hidden"
              aria-label={t('cashier.newCounterOrder')}
            >
              <Plus aria-hidden />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <EmptyState
              icon={ReceiptText}
              title={t('cashier.billsEmpty')}
              description={t('cashier.billsEmptyBody')}
            />
          </div>
        </section>
        <section
          className="hidden min-h-0 overflow-y-auto lg:block"
          aria-label={t('cashier.detailEmpty')}
        >
          <EmptyState
            icon={MousePointerClick}
            title={t('cashier.detailEmpty')}
            description={t('cashier.detailEmptyBody')}
            className="h-full justify-center"
          />
        </section>
      </div>
    </div>
  );
}

export { CashierApp as Component };
