import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '../lib/cn';

export interface StickyActionBarProps extends HTMLAttributes<HTMLDivElement> {
  /** Start side: count and total ("3 items · Rs 1,452"). */
  summary?: ReactNode;
  /** End side: the primary action(s), e.g. Send to Kitchen. */
  children: ReactNode;
}

/**
 * The bar pinned to the bottom of order entry (plan 4.5). Sticky, not fixed, so it never
 * covers the last row, and it clears the phone's home indicator (safe area).
 */
export function StickyActionBar({ summary, children, className, ...props }: StickyActionBarProps) {
  return (
    <div
      data-slot="sticky-action-bar"
      className={cn(
        'sticky bottom-0 z-30 border-t border-border bg-surface/95 shadow-md backdrop-blur',
        'px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        className,
      )}
      {...props}
    >
      <div className="mx-auto flex max-w-5xl items-center gap-4">
        {summary !== undefined && <div className="min-w-0 flex-1">{summary}</div>}
        <div className={cn('flex shrink-0 items-center gap-3', summary === undefined && 'ms-auto')}>
          {children}
        </div>
      </div>
    </div>
  );
}
