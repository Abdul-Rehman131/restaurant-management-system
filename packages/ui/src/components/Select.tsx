import { Check, ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';
import { fieldClasses } from './Input';

/** Popover surfaces (Select, Popover, DropdownMenu, Combobox) share this look and motion. */
export const popoverSurface = cn(
  'z-50 rounded-lg border border-border bg-surface-raised text-fg shadow-md',
  '[--enter-scale:0.96] data-[side=bottom]:[--enter-y:-4px] data-[side=top]:[--enter-y:4px]',
  'data-[state=closed]:animate-exit data-[state=open]:animate-enter',
);

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      className={cn(
        fieldClasses,
        'flex h-control-md items-center justify-between gap-2 text-start',
        'data-placeholder:text-fg-muted [&>span]:truncate',
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown aria-hidden className="size-5 shrink-0 text-fg-muted" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = 'popper',
  ...props
}: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        position={position}
        className={cn(
          popoverSurface,
          'max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) overflow-hidden',
          position === 'popper' && 'my-1',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectLabel({ className, ...props }: ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn('px-3 py-1.5 text-xs font-medium text-fg-muted', className)}
      {...props}
    />
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        'relative flex min-h-control-sm cursor-default items-center gap-2 rounded-md ps-3 pe-9 text-base outline-none select-none',
        'data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-surface-2',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute end-3 inline-flex">
        <Check aria-hidden className="size-4 text-brand" strokeWidth={3} />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
