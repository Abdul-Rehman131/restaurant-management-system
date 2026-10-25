import { cva, type VariantProps } from 'class-variance-authority';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { DialogCloseButton, DialogOverlay } from './Dialog';

/**
 * A panel that slides in from an edge (Radix Dialog). `auto` is a bottom sheet on phones and
 * an inline-end panel from md up. Sides are logical, so `end` is the left edge in RTL.
 */
const sheetVariants = cva(
  [
    'fixed z-50 flex flex-col gap-4 overflow-y-auto border-border bg-surface-raised p-6 text-fg shadow-lg',
    'data-[state=open]:animate-enter data-[state=closed]:animate-exit',
  ],
  {
    variants: {
      side: {
        auto: [
          'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-xl border-t pb-[max(1.5rem,env(safe-area-inset-bottom))] [--enter-y:100%]',
          'md:inset-x-auto md:inset-y-0 md:end-0 md:max-h-none md:w-full md:max-w-md md:rounded-none md:border-s md:border-t-0',
          'md:[--enter-x:100%] md:[--enter-y:0px]',
        ],
        bottom:
          'inset-x-0 bottom-0 max-h-[90dvh] rounded-t-xl border-t pb-[max(1.5rem,env(safe-area-inset-bottom))] [--enter-y:100%]',
        end: 'inset-y-0 end-0 w-full max-w-md border-s [--enter-x:100%]',
        start: 'inset-y-0 start-0 w-full max-w-md border-e [--enter-x:-100%]',
      },
    },
    defaultVariants: { side: 'auto' },
  },
);

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;

export function SheetContent({
  className,
  children,
  side,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & VariantProps<typeof sheetVariants>) {
  return (
    <DialogPrimitive.Portal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(sheetVariants({ side }), className)}
        {...props}
      >
        {children}
        <DialogCloseButton />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export {
  DialogDescription as SheetDescription,
  DialogFooter as SheetFooter,
  DialogHeader as SheetHeader,
  DialogTitle as SheetTitle,
} from './Dialog';
