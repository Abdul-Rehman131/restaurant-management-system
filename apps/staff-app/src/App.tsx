import { useDocumentTitle, usePublicSettings } from '@rms/shared';
import { AppHeader } from '@rms/ui';
import { useTranslation } from 'react-i18next';

const swatches = [
  { key: 'brand', className: 'bg-brand text-brand-fg' },
  { key: 'accent', className: 'bg-accent text-fg' },
  { key: 'success', className: 'bg-success-bg text-success' },
  { key: 'warning', className: 'bg-warning-bg text-warning' },
  { key: 'danger', className: 'bg-danger-bg text-danger' },
  { key: 'info', className: 'bg-info-bg text-info' },
] as const;

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
      <main className="mx-auto max-w-3xl space-y-6 p-4">
        <section className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{t('scaffold.heading')}</h1>
          <p className="text-fg-muted">{t('scaffold.body')}</p>
        </section>

        <section className="space-y-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-sm font-medium text-fg-muted">{t('scaffold.tokens')}</h2>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {swatches.map(({ key, className }) => (
              <li key={key} className={`rounded-md px-3 py-3 text-sm font-medium ${className}`}>
                {t(`scaffold.${key}`)}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="min-h-12 w-full rounded-md bg-brand px-4 font-semibold text-brand-fg transition-transform duration-[120ms] active:scale-[0.98] motion-reduce:transition-none sm:w-auto"
          >
            {t('scaffold.primaryAction')}
          </button>
        </section>
      </main>
    </div>
  );
}
