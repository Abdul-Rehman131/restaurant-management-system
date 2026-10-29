// Loaded only inside the signed-in shell: importing it ties the shell's modules (data
// client, TanStack Query, settings) to the shell chunk instead of splitting them into shared
// chunks the shell would download as extra files (plan 4.10 budgets).
import '../../shell/SignedIn';
import './i18n';

import {
  Button,
  OfflineBanner,
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@rms/ui';
import {
  Calculator,
  FolderOpen,
  LayoutDashboard,
  LayoutGrid,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  UsersRound,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Route, Routes, useLocation } from 'react-router';

import { paths } from '../../paths';
import { RoleNotFound } from '../../screens/RoleNotFound';
import { useConnection } from '../../shell/connection-context';
import { StaffHeader } from '../../shell/StaffHeader';
import { useScreenAppearance } from '../../shell/theme-context';
import { BillCheckScreen } from './BillCheckScreen';
import { CategoriesScreen } from './CategoriesScreen';
import { Dashboard } from './Dashboard';
import { ItemForm } from './ItemForm';
import { useAdminLive } from './live';
import { MenuScreen } from './MenuScreen';
import { adminRoutes } from './paths';
import { SettingsScreen } from './SettingsScreen';
import { StaffScreen } from './StaffScreen';
import { TablesScreen } from './TablesScreen';

type SectionKey =
  'dashboard' | 'menu' | 'categories' | 'tables' | 'staff' | 'settings' | 'billCheck';

const sections: { key: SectionKey; to: string; icon: LucideIcon }[] = [
  { key: 'dashboard', to: '', icon: LayoutDashboard },
  { key: 'menu', to: adminRoutes.menu, icon: UtensilsCrossed },
  { key: 'categories', to: adminRoutes.categories, icon: FolderOpen },
  { key: 'tables', to: adminRoutes.tables, icon: LayoutGrid },
  { key: 'staff', to: adminRoutes.staff, icon: UsersRound },
  { key: 'settings', to: adminRoutes.settings, icon: Settings },
  { key: 'billCheck', to: adminRoutes.billCheck, icon: Calculator },
];

const COLLAPSED_KEY = 'admin-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Nav links. `rail`: icons only, the label for screen readers and as a tooltip. */
function SectionLinks({ rail, onNavigate }: { rail: boolean; onNavigate?: () => void }) {
  const { t } = useTranslation(['admin']);
  return (
    <ul className="grid gap-1">
      {sections.map(({ key, to, icon: Icon }) => {
        const link = (
          <NavLink
            to={to === '' ? paths.admin : `${paths.admin}/${to}`}
            end={to === ''}
            onClick={onNavigate}
            className={({ isActive }) =>
              cn(
                'flex min-h-control-md items-center gap-3 rounded-md px-3 font-medium',
                rail && 'justify-center px-0',
                isActive
                  ? 'bg-brand-100 text-brand-800 dark:text-fg'
                  : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
              )
            }
          >
            <Icon aria-hidden className="size-5 shrink-0" />
            <span className={cn(rail && 'sr-only')}>{t(`admin:nav.${key}`)}</span>
          </NavLink>
        );
        return (
          <li key={key}>
            {rail ? (
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{t(`admin:nav.${key}`)}</TooltipContent>
              </Tooltip>
            ) : (
              link
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Admin: desk density, collapsible sidebar (icon rail at md, full at lg), a sheet on phones,
 * content up to 1280 px (plan 4.5).
 */
export function AdminApp() {
  const { t } = useTranslation(['admin', 'rpc']);
  const { state } = useConnection();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [sheetOpen, setSheetOpen] = useState(false);
  useScreenAppearance({ density: 'desk' });
  useAdminLive();

  const toggle = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
      } catch {
        // Not saved: the sidebar still toggles for this visit.
      }
      return !value;
    });
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <StaffHeader
        leading={
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                aria-label={t('admin:openMenu')}
              >
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="start" className="w-72 max-w-[85vw]">
              <SheetTitle>{t('admin:title')}</SheetTitle>
              <nav aria-label={t('admin:navLabel')}>
                <SectionLinks
                  rail={false}
                  onNavigate={() => {
                    setSheetOpen(false);
                  }}
                />
              </nav>
            </SheetContent>
          </Sheet>
        }
      />
      <OfflineBanner online={state !== 'offline'} />
      <div className="flex flex-1">
        <aside
          className={cn(
            'sticky top-14 hidden h-[calc(100dvh-3.5rem)] shrink-0 flex-col gap-2 border-e border-border bg-surface p-3 md:flex',
            'md:w-[4.5rem]',
            !collapsed && 'lg:w-60',
          )}
        >
          <nav aria-label={t('admin:navLabel')} className="flex-1">
            {/* md: rail. lg: full unless collapsed. Two lists keep each one simple. */}
            <div className={cn(!collapsed && 'lg:hidden')}>
              <SectionLinks rail />
            </div>
            {!collapsed && (
              <div className="hidden lg:block">
                <SectionLinks rail={false} />
              </div>
            )}
          </nav>
          <Button
            variant="ghost"
            size="icon"
            className="hidden self-center lg:inline-flex"
            aria-label={collapsed ? t('admin:expand') : t('admin:collapse')}
            aria-expanded={!collapsed}
            onClick={toggle}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden className="rtl:-scale-x-100" />
            ) : (
              <PanelLeftClose aria-hidden className="rtl:-scale-x-100" />
            )}
          </Button>
        </aside>
        <main key={location.pathname} className="mx-auto w-full max-w-[1280px] flex-1 p-4 md:p-6">
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path={adminRoutes.menu} element={<MenuScreen />} />
            <Route path={adminRoutes.newItem} element={<ItemForm />} />
            <Route path={adminRoutes.item} element={<ItemForm />} />
            <Route path={adminRoutes.categories} element={<CategoriesScreen />} />
            <Route path={adminRoutes.tables} element={<TablesScreen />} />
            <Route path={adminRoutes.staff} element={<StaffScreen />} />
            <Route path={adminRoutes.settings} element={<SettingsScreen />} />
            <Route path={adminRoutes.billCheck} element={<BillCheckScreen />} />
            <Route path="*" element={<RoleNotFound home={paths.admin} />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}

export { AdminApp as Component };
