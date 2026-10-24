import { Constants, PublicSettingsProvider } from '@rms/shared';
import {
  Button,
  ConnectionDot,
  EmptyState,
  ErrorState,
  MoneyText,
  OfflineBanner,
  QtyStepper,
  StatusBadge,
  StickyActionBar,
  toast,
} from '@rms/ui';
import { ReceiptText, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GalleryRow, GallerySection } from '../GallerySection';

// Demo amounts in paisa: the T6 hand-checked totals, a fractional one, zero and a refund.
const demoAmounts = [145200, 9280, 181500, 0, -4800];
const demoItems = { naan: 'Garlic Naan', lassi: 'Sweet Lassi' };

export function DomainSection() {
  const { t } = useTranslation('dev');
  const [naan, setNaan] = useState(2);
  const [lassi, setLassi] = useState(1);
  const [retrying, setRetrying] = useState(false);

  return (
    <GallerySection id="domain" title={t('sections.domain')}>
      <GalleryRow label={t('domain.money')}>
        {demoAmounts.map((amount) => (
          <MoneyText key={amount} amount={amount} className="text-lg font-semibold" />
        ))}
      </GalleryRow>
      <GalleryRow label={t('domain.moneyReceipt')}>
        <MoneyText amount={145200} fraction="always" className="text-2xl font-bold" />
      </GalleryRow>
      <GalleryRow label={t('domain.moneyLoading')}>
        <PublicSettingsProvider value={{ settings: null, loading: true }}>
          <MoneyText amount={145200} />
        </PublicSettingsProvider>
      </GalleryRow>

      <GalleryRow label={t('domain.orderStatus')}>
        {Constants.public.Enums.order_status.map((status) => (
          <StatusBadge key={status} kind="order" status={status} />
        ))}
      </GalleryRow>
      <GalleryRow label={t('domain.tableStatus')}>
        {Constants.public.Enums.table_status.map((status) => (
          <StatusBadge key={status} kind="table" status={status} />
        ))}
      </GalleryRow>
      <GalleryRow label={t('domain.paymentStatus')}>
        {Constants.public.Enums.payment_status.map((status) => (
          <StatusBadge key={status} kind="payment" status={status} />
        ))}
      </GalleryRow>

      <GalleryRow label={t('domain.qty')}>
        <QtyStepper itemName={demoItems.naan} value={naan} onChange={setNaan} />
        <QtyStepper
          itemName={demoItems.lassi}
          value={lassi}
          onChange={setLassi}
          onRemove={() => {
            toast(t('domain.removed', { item: demoItems.lassi }));
          }}
        />
        <span className="text-sm text-fg-muted">{t('domain.qtyRemove')}</span>
      </GalleryRow>

      <GalleryRow label={t('domain.connection')}>
        <ConnectionDot state="online" />
        <ConnectionDot state="connecting" />
        <ConnectionDot state="offline" />
      </GalleryRow>
      <GalleryRow label={t('domain.connectionCompact')}>
        <ConnectionDot state="online" showLabel={false} />
        <ConnectionDot state="connecting" showLabel={false} />
        <ConnectionDot state="offline" showLabel={false} />
      </GalleryRow>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-fg-muted">{t('domain.offline')}</h3>
        <OfflineBanner online={false} className="overflow-hidden rounded-md" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border">
          <EmptyState
            icon={ReceiptText}
            title={t('domain.emptyTitle')}
            description={t('domain.emptyBody')}
            action={<Button>{t('domain.newOrder')}</Button>}
          />
        </div>
        <div className="rounded-lg border border-border">
          <ErrorState
            title={t('domain.errorTitle')}
            description={t('domain.errorBody')}
            retrying={retrying}
            onRetry={() => {
              setRetrying(true);
              window.setTimeout(() => {
                setRetrying(false);
              }, 1200);
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium text-fg-muted">{t('domain.stickyBar')}</h3>
        <div className="overflow-hidden rounded-md border border-border">
          <StickyActionBar
            className="static"
            summary={
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-fg-muted">
                  {t('domain.cartSummary', { count: naan + lassi })}
                </span>
                <MoneyText amount={181500} className="text-lg font-semibold" />
              </p>
            }
          >
            <Button size="lg">
              <Send aria-hidden className="rtl:-scale-x-100" />
              {t('domain.sendToKitchen')}
            </Button>
          </StickyActionBar>
        </div>
      </div>
    </GallerySection>
  );
}
