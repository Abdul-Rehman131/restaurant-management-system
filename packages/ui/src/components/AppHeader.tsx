import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface AppHeaderProps {
  /** From the settings table. Never pass a hardcoded name. */
  restaurantName?: string | undefined;
  /** Show a placeholder while settings load. */
  loading?: boolean;
  /** Translated label used as the logo's alt text when no name is shown. */
  logoLabel: string;
  logoSrc?: string;
  /** Right-aligned slot: connection status, user menu, etc. */
  actions?: ReactNode;
  className?: string;
}

export function AppHeader({
  restaurantName,
  loading = false,
  logoLabel,
  logoSrc = '/brand/logo-mark.svg',
  actions,
  className,
}: AppHeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur',
        className,
      )}
    >
      <img
        src={logoSrc}
        width={32}
        height={32}
        className="size-8 shrink-0 rounded-md"
        alt={restaurantName ? '' : logoLabel}
      />
      {loading ? (
        <span className="h-4 w-32 animate-pulse rounded-sm bg-surface-2 motion-reduce:animate-none" />
      ) : (
        restaurantName && (
          <span className="truncate text-lg font-semibold tracking-tight text-fg">
            {restaurantName}
          </span>
        )
      )}
      {actions && <div className="ms-auto flex items-center gap-2">{actions}</div>}
    </header>
  );
}
