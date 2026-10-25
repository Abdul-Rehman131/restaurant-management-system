import { OfflineBanner, cn } from '@rms/ui';
import { BellRing, ClipboardList, LayoutGrid, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Route, Routes, useMatch } from 'react-router';

import { useAuth } from '../../auth/auth-context';
import { paths } from '../../paths';
import { useConnection } from '../../shell/connection-context';
import { Placeholder } from '../../shell/Placeholder';
import { StaffHeader } from '../../shell/StaffHeader';
import { useScreenAppearance } from '../../shell/theme-context';
import { useWaiterLive } from './live';
import { waiterPaths, waiterRoutes } from './paths';
import { TablesScreen } from './TablesScreen';

const tabs: {
  to: string;
  end: boolean;
  icon: LucideIcon;
  label: 'waiter.tables' | 'waiter.orders' | 'waiter.alerts';
}[] = [
  { to: waiterPaths.tables, end: true, icon: LayoutGrid, label: 'waiter.tables' },
  { to: waiterPaths.orders, end: false, icon: ClipboardList, label: 'waiter.orders' },
  { to: waiterPaths.alerts, end: false, icon: BellRing, label: 'waiter.alerts' },
];

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
  const { session } = useAuth();
  useScreenAppearance({ density: 'touch' });
  useWaiterLive(session?.user.id);
  // Order entry and order detail are full-screen tasks with their own bottom bar.
  const onTable = useMatch(`${paths.waiter}/table/*`) !== null;

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <StaffHeader />
      <OfflineBanner online={state !== 'offline'} />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
        <Routes>
          <Route index element={<TablesScreen />} />
          <Route
            path={waiterRoutes.orders}
            element={
              <SimpleScreen
                icon={ClipboardList}
                title={t('waiter.orders')}
                empty={t('waiter.ordersEmpty')}
              />
            }
          />
          <Route
            path={waiterRoutes.alerts}
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
      {!onTable && (
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
      )}
    </div>
  );
}

export { WaiterApp as Component };
