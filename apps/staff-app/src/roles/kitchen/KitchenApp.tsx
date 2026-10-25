// Loaded only inside the signed-in shell: importing it ties the shell's modules (data
// client, TanStack Query, settings) to the shell chunk instead of splitting them into shared
// chunks the shell would download as extra files (plan 4.10 budgets).
import '../../shell/SignedIn';

import { usePublicSettings } from '@rms/shared';
import { Button, ConnectionDot, OfflineBanner } from '@rms/ui';
import { ChefHat, ListX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Clock } from '../../shell/Clock';
import { useConnection } from '../../shell/connection-context';
import { Placeholder } from '../../shell/Placeholder';
import { AccountMenu } from '../../shell/StaffHeader';
import { useScreenAppearance } from '../../shell/theme-context';
import { useComingSoon } from '../../shell/useComingSoon';

/**
 * Kitchen: full screen, no navigation chrome, always dark, display density (readable from 3 m,
 * plan 4.5 and 4.9). The top bar has the clock, the connection state and the Sold Out list.
 */
export function KitchenApp() {
  const { t } = useTranslation();
  const { settings } = usePublicSettings();
  const { state, canSend } = useConnection();
  const comingSoon = useComingSoon();
  useScreenAppearance({ theme: 'dark', density: 'display' });

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="flex min-h-16 items-center gap-2 border-b border-border bg-surface px-3 sm:gap-4 sm:px-4">
        <h1 className="flex shrink-0 items-center gap-2 text-xl font-semibold">
          <ChefHat aria-hidden className="size-icon text-brand" />
          {/* Phones (rare in a kitchen): icon only, so the clock and actions fit. */}
          <span className="max-sm:sr-only">{t('kitchen.title')}</span>
        </h1>
        {settings && (
          <span className="hidden truncate text-fg-muted md:inline">{settings.restaurantName}</span>
        )}
        <div className="ms-auto flex items-center gap-2 sm:gap-4">
          <Clock className="text-xl font-semibold whitespace-nowrap tabular-nums sm:text-2xl" />
          <ConnectionDot state={state} className="hidden sm:inline-flex" />
          <ConnectionDot state={state} showLabel={false} className="sm:hidden" />
          <Button
            variant="outline"
            disabled={!canSend}
            onClick={comingSoon}
            aria-label={t('kitchen.soldOut')}
            className="max-sm:size-control-md max-sm:px-0"
          >
            <ListX aria-hidden />
            <span className="max-sm:sr-only">{t('kitchen.soldOut')}</span>
          </Button>
          {/* The kitchen is always dark: no theme choice here. */}
          <AccountMenu showTheme={false} />
        </div>
      </header>
      <OfflineBanner online={state !== 'offline'} />
      <main className="grid flex-1 place-items-center p-6">
        <Placeholder icon={ChefHat} title={t('kitchen.queueEmpty')} />
      </main>
    </div>
  );
}

export { KitchenApp as Component };
