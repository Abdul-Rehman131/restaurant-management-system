import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

const toastClassNames = {
  toast:
    'w-full gap-3 rounded-lg border border-border bg-surface-raised p-4 font-sans text-base text-fg shadow-lg',
  description: 'text-sm text-fg-muted',
  actionButton: 'bg-brand! text-brand-fg! font-semibold! rounded-md! min-h-10!',
  cancelButton: 'bg-surface-2! text-fg! rounded-md! min-h-10!',
};

/**
 * Toasts (Sonner), mounted once by UiProvider. Show them with `toast(...)` from @rms/ui.
 * Every type has an icon as well as a colour. Use for confirmations and rollbacks (plan 4.6
 * rule 2), never as the only place an error is shown.
 */
export function Toaster({ dir, ...props }: ToasterProps) {
  const { t } = useTranslation('ui');
  return (
    <Sonner
      dir={dir ?? 'auto'}
      position="top-center"
      containerAriaLabel={t('toast.region')}
      icons={{
        success: <CircleCheck aria-hidden className="size-5 text-success" />,
        error: <CircleAlert aria-hidden className="size-5 text-danger" />,
        warning: <TriangleAlert aria-hidden className="size-5 text-warning" />,
        info: <Info aria-hidden className="size-5 text-info" />,
        loading: (
          <LoaderCircle aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
        ),
      }}
      toastOptions={{
        closeButtonAriaLabel: t('common.close'),
        classNames: toastClassNames,
      }}
      {...props}
    />
  );
}
