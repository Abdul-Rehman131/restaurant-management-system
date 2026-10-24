import { Button, OfflineBanner, cn } from '@rms/ui';
import { BellRing, ClipboardList, LayoutGrid, Plus, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Route, Routes } from 'react-router';

import { paths } from '../../paths';
import { useConnection } from '../../shell/connection-context';
import { Placeholder } from '../../shell/Placeholder';
import { StaffHeader } from '../../shell/StaffHeader';
import { useScreenAppearance } from '../../shell/theme-context';
import { useComingSoon } from '../../shell/useComingSoon';

const sub = { orders: 'orders', alerts: 'alerts' } as const;

const tabs: {
  to: string;
  end: boolean;
  icon: LucideIcon;
  label: 'waiter.tables' | 'waiter.orders' | 'waiter.alerts';
}[] = [
  { to: paths.waiter, end: true, icon: LayoutGrid, label: 'waiter.tables' },
  { to: `${paths.waiter}/${sub.orders}`, end: false, icon: ClipboardList, label: 'waiter.orders' },
  { to: `${paths.waiter}/${sub.alerts}`, end: false, icon: BellRing, label: 'waiter.alerts' },
];

function TablesScreen() {
  const { t } = useTranslation();
  const { canSend } = useConnection();
  const comingSoon = useComingSoon();
  return (
    <>
      <h1 className="sr-only">{t('waiter.tables')}</h1>
      <Placeholder
        icon={LayoutGrid}
        title={t('waiter.tablesEmpty')}
        action={
          <Button size="lg" disabled={!canSend} onClick={comingSoon}>
            <Plus aria-hidden />
            {t('waiter.newOrder')}
          </Button>
        }
      />
    </>
  );
}

function SimpleScreen({ icon, title, empty }: { icon: LucideIcon; title: string; empty: string }) {
  return (
    <>
      <h1 className="sr-only">{title}</h1>
      <Placeholder icon={icon} title={empty} />
    </>
  );
}

/** Waiter: phone first, touch density, bottom navigation (plan 4.5). */
export function WaiterApp() {
  const { t } = useTranslation();
  const { state } = useConnection();
  useScreenAppearance({ density: 'touch' });

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <StaffHeader />
      <OfflineBanner online={state !== 'offline'} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4">
        <Routes>
          <Route index element={<TablesScreen />} />
          <Route
            path={sub.orders}
            element={
              <SimpleScreen
                icon={ClipboardList}
                title={t('waiter.orders')}
                empty={t('waiter.ordersEmpty')}
              />
            }
          />
          <Route
            path={sub.alerts}
            element={
              <SimpleScreen
                icon={BellRing}
                title={t('waiter.alerts')}
                empty={t('waiter.alertsEmpty')}
              />
            }
          />
        </Routes>
      </main>
      <nav
        aria-label={t('waiter.nav')}
        className="sticky bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
      >
        <ul className="mx-auto grid max-w-3xl grid-cols-3">
          {tabs.map(({ to, end, icon: Icon, label }) => (
            <li key={label}>
              <NavLink
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-16 flex-col items-center justify-center gap-1 text-sm font-medium',
                    isActive ? 'text-brand' : 'text-fg-muted hover:text-fg',
                  )
                }
              >
                <Icon aria-hidden className="size-6" />
                {t(label)}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export { WaiterApp as Component };
