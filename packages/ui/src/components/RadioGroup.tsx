import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { hitArea } from '../lib/hit-area';

export function RadioGroup({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-3', className)}
      {...props}
    />
  );
}

export function RadioGroupItem({
  className,
  ...props
}: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'peer size-6 shrink-0 rounded-full border border-input bg-surface',
        'disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-brand',
        hitArea,
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="grid place-items-center">
        <span className="size-3 rounded-full bg-brand" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
}
