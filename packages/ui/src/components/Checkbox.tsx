import { Check } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { hitArea } from '../lib/hit-area';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        'peer size-6 shrink-0 rounded-sm border border-input bg-surface text-brand-fg',
        'transition-colors duration-(--motion-feedback)',
        'data-[state=checked]:border-brand data-[state=checked]:bg-brand',
        'disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-danger',
        hitArea,
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="grid place-items-center">
        <Check aria-hidden className="size-4" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
