import { usePublicSettings } from '@rms/shared';
import {
  AppHeader,
  Button,
  ConnectionDot,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  type Theme,
} from '@rms/ui';
import { CircleUserRound, LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useAuth } from '../auth/auth-context';
import { paths } from '../paths';
import { useConnection } from './connection-context';
import { useTheme } from './theme-context';

const themes: Theme[] = ['light', 'dark', 'system'];
const themeLabel = {
  light: 'shell.themeLight',
  dark: 'shell.themeDark',
  system: 'shell.themeSystem',
} as const;

/** Account menu: who is signed in, theme, sign out. */
export function AccountMenu({ showTheme = true }: { showTheme?: boolean }) {
  const { t } = useTranslation();
  const auth = useAuth();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const metadata = auth.session?.user.user_metadata as { full_name?: unknown } | undefined;
  const name = typeof metadata?.full_name === 'string' ? metadata.full_name : null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('shell.account')}>
          <CircleUserRound aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {name && <DropdownMenuLabel>{t('shell.signedInAs', { name })}</DropdownMenuLabel>}
        {showTheme && (
          <>
            <DropdownMenuLabel>{t('shell.theme')}</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={theme}
              onValueChange={(value) => {
                const next = themes.find((option) => option === value);
                if (next) setTheme(next);
              }}
            >
              {themes.map((option) => (
                <DropdownMenuRadioItem key={option} value={option}>
                  {t(themeLabel[option])}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onSelect={() => {
            void auth.signOut().then(() => navigate(paths.login, { replace: true }));
          }}
        >
          <LogOut aria-hidden className="rtl:-scale-x-100" />
          {t('shell.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Header for waiter, cashier and admin: restaurant name from settings, connection, account. */
export function StaffHeader({ leading, actions }: { leading?: ReactNode; actions?: ReactNode }) {
  const { t } = useTranslation();
  const { settings, loading } = usePublicSettings();
  const { state } = useConnection();

  return (
    <AppHeader
      restaurantName={settings?.restaurantName}
      loading={loading}
      logoLabel={t('app.logoLabel')}
      leading={leading}
      actions={
        <>
          {actions}
          <ConnectionDot state={state} className="hidden sm:inline-flex" />
          <ConnectionDot state={state} showLabel={false} className="sm:hidden" />
          <AccountMenu />
        </>
      }
    />
  );
}
