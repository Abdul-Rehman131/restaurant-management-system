import type { HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn';

/**
 * Placeholder shaped like the content that is loading (plan 4.6 rule 3). Static on purpose:
 * no looping animation (plan 4.3). Decorative; wrap a group in SkeletonGroup so screen readers
 * hear "Loading" once.
 */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn('rounded-md bg-border/70', className)}
      {...props}
    />
  );
}

export function SkeletonGroup({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const { t } = useTranslation('ui');
  return (
    <div role="status" aria-busy className={className} {...props}>
      <span className="sr-only">{t('common.loading')}</span>
      {children}
    </div>
  );
}

// ---------- Presets: the shapes the P1 screens load ----------

/** Paragraph lines; the last one is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <SkeletonGroup className={cn('grid gap-2', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cn('h-4', i === lines - 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </SkeletonGroup>
  );
}

/** A list of rows such as bills or orders: title and meta on the start, amount on the end. */
export function SkeletonList({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <SkeletonGroup className={cn('divide-y divide-border', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 py-3">
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </SkeletonGroup>
  );
}

/** A card with a heading, two lines and an action row. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <SkeletonGroup
      className={cn('grid gap-3 rounded-lg border border-border bg-surface p-5', className)}
    >
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="mt-2 h-control-sm w-28" />
    </SkeletonGroup>
  );
}

/** A grid of square tiles: the waiter's table grid or the menu item grid. */
export function SkeletonTiles({ tiles = 8, className }: { tiles?: number; className?: string }) {
  return (
    <SkeletonGroup
      className={cn('grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6', className)}
    >
      {Array.from({ length: tiles }, (_, i) => (
        <Skeleton key={i} className="aspect-square rounded-lg" />
      ))}
    </SkeletonGroup>
  );
}
