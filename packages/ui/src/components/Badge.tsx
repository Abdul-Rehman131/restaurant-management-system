import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';

import { cn } from '../lib/cn';

/**
 * Small labels and counts (cart count, ADD-ON, "New"). Not for status: order, table and
 * payment status always use StatusBadge, which pairs colour with an icon and a label.
 */
export const badgeVariants = cva(
  'inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold whitespace-nowrap tabular-nums',
  {
    variants: {
      variant: {
        neutral: 'bg-surface-2 text-fg',
        outline: 'border border-input text-fg',
        brand: 'bg-brand text-brand-fg',
        accent: 'bg-accent text-accent-fg',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}
