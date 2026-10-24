import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn';

export const buttonVariants = cva(
  [
    'relative inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-semibold whitespace-nowrap select-none',
    'transition-[background-color,border-color,color,transform] duration-(--motion-feedback) ease-enter',
    'motion-safe:active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
    'aria-disabled:pointer-events-none aria-disabled:opacity-50',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  ],
  {
    variants: {
      variant: {
        primary: 'bg-brand text-brand-fg hover:bg-brand-600',
        secondary: 'bg-surface-2 text-fg hover:bg-border',
        outline: 'border border-input bg-surface text-fg hover:bg-surface-2',
        ghost: 'text-fg hover:bg-surface-2',
        destructive: 'bg-danger text-danger-fg hover:bg-danger/90',
      },
      size: {
        sm: 'h-control-sm px-3 text-sm',
        md: 'h-control-md px-4 text-base',
        lg: 'h-control-lg px-6 text-lg',
        xl: 'h-control-xl px-8 text-xl',
        icon: 'size-control-md',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  /** Render the child element (e.g. a link) with button styles. */
  asChild?: boolean;
  /** Shows a spinner, keeps the label for layout, and blocks presses (plan 4.6 rule 1). */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  type,
  ...props
}: ButtonProps) {
  const { t } = useTranslation('ui');
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      type={asChild ? type : (type ?? 'button')}
      {...props}
    >
      {loading ? (
        <>
          <span className="invisible contents">{children}</span>
          <span className="absolute inset-0 grid place-items-center">
            <LoaderCircle aria-hidden className="animate-spin motion-reduce:animate-none" />
            <span className="sr-only">{t('common.loading')}</span>
          </span>
        </>
      ) : (
        children
      )}
    </Comp>
  );
}
