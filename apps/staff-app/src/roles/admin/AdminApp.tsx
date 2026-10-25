// Loaded only inside the signed-in shell: importing it ties the shell's modules (data
// client, TanStack Query, settings) to the shell chunk instead of splitting them into shared
// chunks the shell would download as extra files (plan 4.10 budgets).
import '../../shell/SignedIn';

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
  BarChart3,
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
import { useConnection } from '../../shell/connection-context';
import { Placeholder } from '../../shell/Placeholder';
import { StaffHeader } from '../../shell/StaffHeader';
import { useScreenAppearance } from '../../shell/theme-context';

type SectionKey = 'dashboard' | 'menu' | 'tables' | 'staff' | 'settings' | 'reports';

const sections: { key: SectionKey; to: string; icon: LucideIcon }[] = [
  { key: 'dashboard', to: '', icon: LayoutDashboard },
  { key: 'menu', to: 'menu', icon: UtensilsCrossed },
  { key: 'tables', to: 'tables', icon: LayoutGrid },
  { key: 'staff', to: 'staff', icon: UsersRound },
  { key: 'settings', to: 'settings', icon: Settings },
  { key: 'reports', to: 'reports', icon: BarChart3 },
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
  const { t } = useTranslation();
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
            <span className={cn(rail && 'sr-only')}>{t(`admin.${key}`)}</span>
          </NavLink>
        );
        return (
          <li key={key}>
            {rail ? (
              <Tooltip>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{t(`admin.${key}`)}</TooltipContent>
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

function SectionScreen({ section }: { section: SectionKey }) {
  const { t } = useTranslation();
  const current = sections.find((s) => s.key === section) ?? sections[0];
  const title = t(`admin.${section}`);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <div className="rounded-lg border border-border bg-surface">
        {current && (
          <Placeholder
            icon={current.icon}
            title={t('admin.sectionEmpty', { section: title })}
            description={null}
          />
        )}
      </div>
    </div>
  );
}

/**
 * Admin: desk density, collapsible sidebar (icon rail at md, full at lg), a sheet on phones,
 * content up to 1280 px (plan 4.5).
 */
export function AdminApp() {
  const { t } = useTranslation();
  const { state } = useConnection();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [sheetOpen, setSheetOpen] = useState(false);
  useScreenAppearance({ density: 'desk' });

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
                aria-label={t('admin.openMenu')}
              >
                <Menu aria-hidden />
              </Button>
            </SheetTrigger>
            <SheetContent side="start" className="w-72 max-w-[85vw]">
              <SheetTitle>{t('admin.title')}</SheetTitle>
              <nav aria-label={t('admin.nav')}>
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
          <nav aria-label={t('admin.nav')} className="flex-1">
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
            aria-label={collapsed ? t('admin.expand') : t('admin.collapse')}
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
            <Route index element={<SectionScreen section="dashboard" />} />
            {sections.slice(1).map(({ key, to }) => (
              <Route key={key} path={to} element={<SectionScreen section={key} />} />
            ))}
          </Routes>
        </main>
      </div>
    </div>
  );
}

export { AdminApp as Component };
