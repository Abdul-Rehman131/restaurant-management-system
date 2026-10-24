import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface EmptyStateProps {
  icon: LucideIcon;
  /** One line: what is empty ("No open bills"). */
  title: string;
  description?: string;
  /** At most one action ("New counter order"). */
  action?: ReactNode;
  className?: string;
}

/** Nothing to show yet: icon, one line, one action (plan 4.4). */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}
    >
      <span className="grid size-14 place-items-center rounded-full bg-surface-2 text-fg-muted">
        <Icon aria-hidden className="size-7" />
      </span>
      <p className="text-lg font-semibold">{title}</p>
      {description && <p className="max-w-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
