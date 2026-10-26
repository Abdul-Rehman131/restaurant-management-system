import { Badge, Input, Label, StickyActionBar, Switch, Textarea, cn } from '@rms/ui';
import { Archive, Ban, Check, ImageOff } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';
import type { FieldError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { photoUrl } from './data';

/**
 * Building blocks of the Admin screens (plan 4.4, 4.9): page header, single-column form
 * sections, labelled fields whose messages are `admin:` keys, the sticky Save bar, the photo
 * placeholder. The action hook (refetch after the server confirms) is in action.ts.
 */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A titled group of fields (single column, plan 4.9). */
export function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="space-y-4 rounded-lg border border-border bg-surface p-4 md:p-6"
    >
      <div className="space-y-1">
        <h2 id={id} className="text-lg font-semibold">
          {title}
        </h2>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** A field's error: the Zod message is an `admin:` key (forms.ts). */
function FieldMessage({ id, error }: { id: string; error: FieldError | undefined }) {
  const { t } = useTranslation(['admin']);
  if (!error?.message) return null;
  const key = error.message.startsWith('admin:') ? error.message : 'admin:form.invalid';
  return (
    <p id={id} className="text-sm font-medium text-danger">
      {t(key as 'admin:form.invalid')}
    </p>
  );
}

type InputProps = Omit<ComponentProps<typeof Input>, 'id'>;

/** A labelled text input wired to react-hook-form (`register`). */
export function TextField({
  label,
  hint,
  error,
  multiline = false,
  className,
  ...props
}: InputProps & {
  label: string;
  hint?: string | undefined;
  error?: FieldError | undefined;
  multiline?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  const shared = {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy || undefined,
  };
  return (
    <div className={cn('grid gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {multiline ? (
        <Textarea {...shared} {...(props as ComponentProps<typeof Textarea>)} />
      ) : (
        <Input {...shared} {...props} />
      )}
      {hint && (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      )}
      <FieldMessage id={errorId} error={error} />
    </div>
  );
}

/** A labelled switch with an explanation (pricing rules, needs kitchen, ...). */
export function SwitchField({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint?: string | undefined;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id}>{label}</Label>
        {hint && (
          <p id={hintId} className="text-sm text-fg-muted">
            {hint}
          </p>
        )}
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-describedby={hint ? hintId : undefined}
        disabled={disabled}
      />
    </div>
  );
}

/** The sticky Save bar under a form (plan 4.9). */
export function SaveBar({ summary, children }: { summary?: ReactNode; children: ReactNode }) {
  return (
    <StickyActionBar summary={summary} className="-mx-4 md:-mx-6">
      {children}
    </StickyActionBar>
  );
}

/** Archived, sold out or active: an icon and a word, never colour alone (plan 4.7). */
export function StateBadge({ archived, soldOut }: { archived: boolean; soldOut?: boolean }) {
  const { t } = useTranslation(['admin']);
  if (archived) {
    return (
      <Badge variant="outline">
        <Archive aria-hidden className="size-3.5" />
        {t('admin:state.archived')}
      </Badge>
    );
  }
  if (soldOut) {
    return (
      <Badge variant="accent">
        <Ban aria-hidden className="size-3.5" />
        {t('admin:state.soldOut')}
      </Badge>
    );
  }
  return (
    <Badge variant="neutral">
      <Check aria-hidden className="size-3.5" />
      {t('admin:state.active')}
    </Badge>
  );
}

/** A menu photo, or the placeholder when there is none. */
export function Photo({
  path,
  alt,
  className,
}: {
  path: string | null;
  alt: string;
  className?: string;
}) {
  const { t } = useTranslation(['admin']);
  if (!path) {
    return (
      <span
        role="img"
        aria-label={t('admin:menu.noPhoto')}
        className={cn(
          'grid shrink-0 place-items-center rounded-md bg-surface-2 text-fg-muted',
          className,
        )}
      >
        <ImageOff aria-hidden className="size-5" />
      </span>
    );
  }
  return (
    <img
      src={photoUrl(path)}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={cn('shrink-0 rounded-md bg-surface-2 object-cover', className)}
    />
  );
}
