import type { Enums } from '@rms/shared';
import {
  BadgeCheck,
  Ban,
  BellRing,
  Bike,
  ChefHat,
  CircleAlert,
  CircleCheck,
  CircleCheckBig,
  CircleDashed,
  Clock,
  PackageCheck,
  ReceiptText,
  Send,
  Users,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import type { HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneClasses: Record<Tone, string> = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
  info: 'bg-info-bg text-info',
  neutral: 'bg-surface-2 text-fg-muted',
};

interface Look {
  tone: Tone;
  icon: LucideIcon;
}

// Every value of every enum has a look: a new enum value fails the type check until it does.
const looks = {
  order: {
    pending: { tone: 'warning', icon: Clock },
    accepted: { tone: 'info', icon: Send },
    preparing: { tone: 'info', icon: ChefHat },
    ready: { tone: 'success', icon: BellRing },
    served: { tone: 'neutral', icon: UtensilsCrossed },
    out_for_delivery: { tone: 'info', icon: Bike },
    delivered: { tone: 'success', icon: PackageCheck },
    delivery_failed: { tone: 'danger', icon: CircleAlert },
    completed: { tone: 'neutral', icon: CircleCheckBig },
    cancelled: { tone: 'danger', icon: Ban },
  },
  table: {
    available: { tone: 'success', icon: CircleCheck },
    occupied: { tone: 'info', icon: Users },
    bill_requested: { tone: 'warning', icon: ReceiptText },
  },
  payment: {
    unpaid: { tone: 'warning', icon: CircleDashed },
    paid: { tone: 'success', icon: BadgeCheck },
  },
} satisfies {
  order: Record<Enums<'order_status'>, Look>;
  table: Record<Enums<'table_status'>, Look>;
  payment: Record<Enums<'payment_status'>, Look>;
};

export type StatusBadgeProps = Omit<HTMLAttributes<HTMLSpanElement>, 'children'> &
  (
    | { kind: 'order'; status: Enums<'order_status'> }
    | { kind: 'table'; status: Enums<'table_status'> }
    | { kind: 'payment'; status: Enums<'payment_status'> }
  );

/**
 * Status is colour PLUS icon PLUS label, never colour alone (plan 4.1). Brand colour never
 * means status. Labels come from the ui namespace: status.<kind>.<status>.
 */
export function StatusBadge({ kind, status, className, ...props }: StatusBadgeProps) {
  const { t } = useTranslation('ui');
  const look: Look = (looks[kind] as Record<string, Look>)[status] ?? {
    tone: 'neutral',
    icon: CircleDashed,
  };
  const Icon = look.icon;
  const label =
    kind === 'order'
      ? t(`status.order.${status}`)
      : kind === 'table'
        ? t(`status.table.${status}`)
        : t(`status.payment.${status}`);

  return (
    <span
      data-slot="status-badge"
      data-status={status}
      className={cn(
        'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full ps-2 pe-3 text-sm font-semibold whitespace-nowrap',
        toneClasses[look.tone],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden className="size-4 shrink-0" strokeWidth={2.25} />
      {label}
    </span>
  );
}
