import { X } from 'lucide-react';
import { AlertDialog as AlertDialogPrimitive, Dialog as DialogPrimitive } from 'radix-ui';
import type { ComponentProps, HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn';
import { buttonVariants } from './Button';

/** Backdrop for Dialog, AlertDialog, Sheet and Drawer. */
export const overlayClasses = cn(
  'fixed inset-0 z-50 bg-overlay/50',
  'data-[state=closed]:animate-exit data-[state=open]:animate-enter',
);

/** Centred panel. `translate` (not transform) centres it, so the enter keyframes compose. */
export const dialogPanelClasses = cn(
  'fixed inset-x-4 top-1/2 z-50 mx-auto grid max-h-[calc(100dvh-2rem)] w-auto max-w-lg -translate-y-1/2 gap-4 overflow-y-auto',
  'rounded-xl border border-border bg-surface-raised p-6 text-fg shadow-lg',
  '[--enter-scale:0.96] data-[state=closed]:animate-exit data-[state=open]:animate-enter',
);

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return <DialogPrimitive.Overlay className={cn(overlayClasses, className)} {...props} />;
}

/** The ✕ button in the corner (inline end). */
export function DialogCloseButton({ className }: { className?: string }) {
  const { t } = useTranslation('ui');
  return (
    <DialogPrimitive.Close
      className={cn(
        buttonVariants({ variant: 'ghost', size: 'icon' }),
        'absolute end-2 top-2 size-control-sm',
        className,
      )}
    >
      <X aria-hidden />
      <span className="sr-only">{t('common.close')}</span>
    </DialogPrimitive.Close>
  );
}

export function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(dialogPanelClasses, className)}
        {...props}
      >
        {children}
        {showClose && <DialogCloseButton />}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid gap-1.5 pe-8 text-start', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex flex-col-reverse gap-3 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg leading-tight font-semibold', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn('text-fg-muted', className)} {...props} />;
}

// ---------- AlertDialog: confirms destructive or irreversible actions only (plan 4.6 rule 5) ----------

export const AlertDialog = AlertDialogPrimitive.Root;
export const AlertDialogTrigger = AlertDialogPrimitive.Trigger;

export function AlertDialogContent({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Content>) {
  return (
    <AlertDialogPrimitive.Portal>
      <AlertDialogPrimitive.Overlay className={overlayClasses} />
      <AlertDialogPrimitive.Content
        data-slot="alert-dialog-content"
        className={cn(dialogPanelClasses, className)}
        {...props}
      />
    </AlertDialogPrimitive.Portal>
  );
}

export const AlertDialogHeader = DialogHeader;
export const AlertDialogFooter = DialogFooter;

export function AlertDialogTitle({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Title>) {
  return (
    <AlertDialogPrimitive.Title
      className={cn('text-lg leading-tight font-semibold', className)}
      {...props}
    />
  );
}

export function AlertDialogDescription({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Description>) {
  return <AlertDialogPrimitive.Description className={cn('text-fg-muted', className)} {...props} />;
}

export function AlertDialogAction({
  className,
  destructive = false,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Action> & { destructive?: boolean }) {
  return (
    <AlertDialogPrimitive.Action
      className={cn(
        buttonVariants({ variant: destructive ? 'destructive' : 'primary' }),
        className,
      )}
      {...props}
    />
  );
}

export function AlertDialogCancel({
  className,
  ...props
}: ComponentProps<typeof AlertDialogPrimitive.Cancel>) {
  return (
    <AlertDialogPrimitive.Cancel
      className={cn(buttonVariants({ variant: 'outline' }), className)}
      {...props}
    />
  );
}
