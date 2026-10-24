import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'peer inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-input p-0.5',
        'transition-colors duration-(--motion-feedback)',
        'data-[state=checked]:border-brand data-[state=checked]:bg-brand data-[state=unchecked]:bg-surface-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        "relative before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none block size-5.5 rounded-full shadow-sm',
          'transition-transform duration-(--motion-feedback) ease-enter',
          'data-[state=checked]:bg-brand-fg data-[state=unchecked]:bg-input',
          // Logical: the thumb moves toward the inline end, in LTR and RTL.
          'data-[state=checked]:translate-x-5 rtl:data-[state=checked]:-translate-x-5',
        )}
      />
    </SwitchPrimitive.Root>
  );
}
