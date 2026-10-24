import { CircleOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn';

export type ConnectionState = 'online' | 'connecting' | 'offline';

const dotClasses: Record<ConnectionState, string> = {
  // Shapes differ as well as colours: filled, dashed ring, crossed out.
  online: 'size-2.5 rounded-full bg-success',
  connecting: 'size-3 rounded-full border-2 border-dashed border-warning',
  offline: '',
};

export interface ConnectionDotProps {
  state: ConnectionState;
  /** Hide the text on tight bars; it stays available to screen readers and as a tooltip. */
  showLabel?: boolean;
  className?: string;
}

/** Always visible on staff screens (plan 4.6 rule 7). */
export function ConnectionDot({ state, showLabel = true, className }: ConnectionDotProps) {
  const { t } = useTranslation('ui');
  const label = t(`connection.${state}`);

  return (
    <span
      role="status"
      data-state={state}
      title={showLabel ? undefined : label}
      className={cn('inline-flex min-h-6 items-center gap-2 text-sm font-medium', className)}
    >
      <span aria-hidden className="grid size-4 place-items-center">
        {state === 'offline' ? (
          <CircleOff className="size-4 text-danger" strokeWidth={2.5} />
        ) : (
          <span className={dotClasses[state]} />
        )}
      </span>
      <span className={cn(showLabel ? 'text-fg' : 'sr-only')}>{label}</span>
    </span>
  );
}
