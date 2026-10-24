import { useDocumentTitle, usePublicSettings } from '@rms/shared';
import { AppHeader } from '@rms/ui';
import { useTranslation } from 'react-i18next';

// Phase 0 placeholder. The real website (menu, cart, checkout, tracking) is built in P2.
export function App() {
  const { t } = useTranslation();
  const { settings, loading } = usePublicSettings();
  useDocumentTitle(t('app.title'), settings?.restaurantName);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <AppHeader
        restaurantName={settings?.restaurantName}
        loading={loading}
        logoLabel={t('app.logoLabel')}
      />
      <main className="mx-auto grid max-w-xl place-items-center gap-3 px-4 py-24 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">{t('placeholder.heading')}</h1>
        <p className="text-fg-muted">{t('placeholder.body')}</p>
      </main>
    </div>
  );
}
