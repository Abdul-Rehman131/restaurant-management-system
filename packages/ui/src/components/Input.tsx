import type { ComponentProps } from 'react';

import { cn } from '../lib/cn';

/** Shared field look: Input, Textarea and the Select and Combobox triggers. */
export const fieldClasses = cn(
  'w-full min-w-0 rounded-md border border-input bg-surface px-3 text-base text-fg',
  'placeholder:text-fg-muted disabled:cursor-not-allowed disabled:opacity-50',
  'aria-invalid:border-danger aria-invalid:outline-danger',
);

export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      type={type}
      className={cn(fieldClasses, 'h-control-md', className)}
      {...props}
    />
  );
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(fieldClasses, 'min-h-24 py-2.5 leading-relaxed', className)}
      {...props}
    />
  );
}
