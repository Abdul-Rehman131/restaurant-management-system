import { Tooltip as TooltipPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

// Supplementary hints only; never the only label of a control.

export const TooltipProvider = TooltipPrimitive.Provider;
/**
 * Each tooltip carries its own provider, so the tooltip code (Floating UI) loads only with the
 * screens that use one, not with every app's first screen (plan 4.10).
 */
export function Tooltip({
  delayDuration = 300,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipPrimitive.Provider delayDuration={delayDuration}>
      <TooltipPrimitive.Root {...props} />
    </TooltipPrimitive.Provider>
  );
}
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 6,
  children,
  ...props
}: ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          // Inverted: text colour as background, so contrast equals body text.
          'z-50 max-w-xs rounded-md bg-fg px-3 py-1.5 text-sm text-bg',
          '[--enter-scale:0.96] data-[state=closed]:animate-exit data-[state=delayed-open]:animate-enter data-[state=instant-open]:animate-enter',
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-fg" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}
