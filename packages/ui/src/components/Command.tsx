import { Command as CommandPrimitive, useCommandState } from 'cmdk';
import { Search } from 'lucide-react';
import { useRef, type ComponentProps, type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './Dialog';

/** Search list (cmdk): the search palette, and the list inside Combobox. */
export function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn('flex size-full flex-col overflow-hidden text-fg', className)}
      {...props}
    />
  );
}

export function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3">
      <Search aria-hidden className="size-5 shrink-0 text-fg-muted" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          'h-control-md w-full bg-transparent text-base outline-none placeholder:text-fg-muted',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function CommandList({
  className,
  label,
  ...props
}: ComponentProps<typeof CommandPrimitive.List>) {
  const { t } = useTranslation('ui');
  return (
    <CommandPrimitive.List
      label={label ?? t('command.results')}
      className={cn('max-h-80 scroll-py-1 overflow-x-hidden overflow-y-auto p-1', className)}
      {...props}
    />
  );
}

export function CommandEmpty({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      className={cn('py-6 text-center text-fg-muted', className)}
      {...props}
    />
  );
}

export function CommandGroup({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      className={cn(
        '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs',
        '[&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-muted',
        className,
      )}
      {...props}
    />
  );
}

export function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'relative flex min-h-control-sm cursor-default items-center gap-3 rounded-md px-3 text-base outline-none select-none',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-surface-2',
        "[&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A visual divider. Not cmdk's Separator: its role="separator" is not allowed inside a listbox
 * (axe aria-required-children). Hidden while searching, like cmdk's.
 */
export function CommandSeparator({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const searching = useCommandState((state) => state.search.length > 0);
  if (searching) return null;
  return <div role="none" className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

export function CommandShortcut({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={cn('ms-auto text-xs tracking-widest text-fg-muted', className)} {...props} />
  );
}

/**
 * Search palette in a dialog. Title and description are read by screen readers only. It is
 * opened from code (a shortcut), not a Trigger, so it returns focus itself on close.
 */
export function CommandDialog({
  title,
  description,
  children,
  ...props
}: ComponentProps<typeof Dialog> & { title: string; description: string }) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog {...props}>
      <DialogContent
        className="overflow-hidden p-0"
        showClose={false}
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocus.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>
        <Command label={title}>{children}</Command>
      </DialogContent>
    </Dialog>
  );
}
