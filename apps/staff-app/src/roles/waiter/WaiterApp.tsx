// Loaded only inside the signed-in shell: importing it ties the shell's modules (data
// client, TanStack Query, settings) to the shell chunk instead of splitting them into shared
// chunks the shell would download as extra files (plan 4.10 budgets).
import '../../shell/SignedIn';
import './i18n';

import { Badge, OfflineBanner, cn } from '@rms/ui';
import { BellRing, ClipboardList, LayoutGrid, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Route, Routes, useMatch } from 'react-router';

import { useAuth } from '../../auth/auth-context';
import { paths } from '../../paths';
import { useConnection } from '../../shell/connection-context';
import { StaffHeader } from '../../shell/StaffHeader';
import { useScreenAppearance } from '../../shell/theme-context';
import { ReadyBanner, ShiftControl } from './AlertParts';
import { useAlertStore, useReadyAlerts } from './alerts';
import { AlertsScreen } from './AlertsScreen';
import { useWaiterLive } from './live';
import { OrdersScreen } from './OrdersScreen';
import { waiterPaths, waiterRoutes } from './paths';
import { TableRoute } from './TableRoute';
import { TablesScreen } from './TablesScreen';

const tabs: {
  to: string;
  end: boolean;
  icon: LucideIcon;
  label: 'waiter:tables' | 'waiter:orders' | 'waiter:alerts';
}[] = [
  { to: waiterPaths.tables, end: true, icon: LayoutGrid, label: 'waiter:tables' },
  { to: waiterPaths.orders, end: false, icon: ClipboardList, label: 'waiter:orders' },
  { to: waiterPaths.alerts, end: false, icon: BellRing, label: 'waiter:alerts' },
];

/** Waiter: phone first, touch density, bottom navigation (plan 4.5). */
export function WaiterApp() {
  const { t } = useTranslation(['waiter', 'rpc']);
  const { state } = useConnection();
  const { session } = useAuth();
  useScreenAppearance({ density: 'touch' });
  useWaiterLive(session?.user.id);
  useReadyAlerts();
  const unread = useAlertStore((s) => s.alerts.filter((a) => !a.read).length);
  // Order entry and order detail are full-screen tasks with their own bottom bar.
  const onTable = useMatch(`${paths.waiter}/table/*`) !== null;

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <StaffHeader actions={<ShiftControl />} />
      <OfflineBanner online={state !== 'offline'} />
      <ReadyBanner />
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
        <Routes>
          <Route index element={<TablesScreen />} />
          <Route path={waiterRoutes.table} element={<TableRoute adding={false} />} />
          <Route path={waiterRoutes.addItems} element={<TableRoute adding />} />
          <Route path={waiterRoutes.orders} element={<OrdersScreen />} />
          <Route path={waiterRoutes.alerts} element={<AlertsScreen />} />
        </Routes>
      </main>
      {!onTable && (
        <nav
          aria-label={t('waiter:nav')}
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
                  <span className="relative">
                    <Icon aria-hidden className="size-6" />
                    {label === 'waiter:alerts' && unread > 0 && (
                      <Badge
                        variant="accent"
                        className="absolute -end-3 -top-2 h-5 min-w-5 justify-center px-1.5"
                      >
                        <span aria-hidden>{unread}</span>
                        <span className="sr-only">
                          {t('waiter:alertsBadge', { count: unread })}
                        </span>
                      </Badge>
                    )}
                  </span>
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
