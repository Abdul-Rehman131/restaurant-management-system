import type { Enums } from '@rms/shared';
import { cn } from '@rms/ui';
import {
  ArrowLeft,
  Ban,
  BellRing,
  ChefHat,
  Send,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

/** "12 min" or "1 h 5 min" since a server timestamp. */
export function OrderAge({ since, now }: { since: string; now: number }) {
  const { t } = useTranslation(['waiter', 'rpc']);
  const minutes = Math.max(0, Math.floor((now - Date.parse(since)) / 60_000));
  return (
    <span className="tabular-nums">
      {minutes < 60
        ? t('waiter:ageMinutes', { minutes })
        : t('waiter:ageHours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 })}
    </span>
  );
}

type Tone = 'info' | 'success' | 'neutral' | 'danger';
const toneClasses: Record<Tone, string> = {
  info: 'bg-info-bg text-info',
  success: 'bg-success-bg text-success',
  neutral: 'bg-surface-2 text-fg-muted',
  danger: 'bg-danger-bg text-danger',
};
const batchLooks: Record<Enums<'batch_status'>, { tone: Tone; icon: LucideIcon }> = {
  sent: { tone: 'info', icon: Send },
  preparing: { tone: 'info', icon: ChefHat },
  ready: { tone: 'success', icon: BellRing },
  served: { tone: 'neutral', icon: UtensilsCrossed },
  cancelled: { tone: 'danger', icon: Ban },
};

/** Kitchen status of one batch: colour plus icon plus label (plan 4.1). */
export function BatchBadge({ status }: { status: Enums<'batch_status'> }) {
  const { t } = useTranslation(['waiter', 'rpc']);
  const { tone, icon: Icon } = batchLooks[status];
  return (
    <span
      data-status={status}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full ps-2 pe-3 text-sm font-semibold whitespace-nowrap',
        toneClasses[tone],
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" strokeWidth={2.25} />
      {t(`waiter:batchStatus.${status}`)}
    </span>
  );
}

/** Title row of a sub-screen (order entry, order detail): back to Tables, title, extras. */
export function ScreenTitle({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  back: string;
  children?: ReactNode;
}) {
  const { t } = useTranslation(['waiter', 'rpc']);
  return (
    <div className="flex items-center gap-2 py-3">
      <Link
        to={back}
        aria-label={t('waiter:back')}
        className="-ms-2 grid size-control-md shrink-0 place-items-center rounded-md text-fg hover:bg-surface-2"
      >
        <ArrowLeft aria-hidden className="size-6 rtl:-scale-x-100" />
      </Link>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold">{title}</h1>
        {subtitle && <p className="truncate text-sm text-fg-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
