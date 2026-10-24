import { Slot } from 'radix-ui';
import { createContext, useContext, useId, type ComponentProps, type HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Controller,
  FormProvider,
  useFormContext,
  useFormState,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form';

import enUi from '../i18n/locales/en/ui.json';
import { cn } from '../lib/cn';
import { Label } from './Label';

/**
 * React Hook Form wiring (shadcn pattern). Zod messages are i18n keys from the ui namespace,
 * e.g. z.string().min(1, 'validation.required'); FormMessage translates them.
 */
export const Form = FormProvider;

type ValidationKey = `validation.${keyof typeof enUi.validation}`;

function isValidationKey(message: string): message is ValidationKey {
  return message.startsWith('validation.') && message.slice(11) in enUi.validation;
}

interface FieldContextValue {
  name: string;
}
const FieldContext = createContext<FieldContextValue | null>(null);
const ItemContext = createContext<{ id: string } | null>(null);

export function FormField<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>(props: ControllerProps<TFieldValues, TName>) {
  return (
    <FieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FieldContext.Provider>
  );
}

export function useFormField() {
  const field = useContext(FieldContext);
  const item = useContext(ItemContext);
  const { getFieldState } = useFormContext();
  const formState = useFormState({ name: field?.name ?? '' });
  if (!field || !item)
    throw new Error('useFormField must be used inside <FormField> and <FormItem>');

  const state = getFieldState(field.name, formState);
  return {
    name: field.name,
    formItemId: `${item.id}-item`,
    formDescriptionId: `${item.id}-description`,
    formMessageId: `${item.id}-message`,
    ...state,
  };
}

export function FormItem({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const id = useId();
  return (
    <ItemContext.Provider value={{ id }}>
      <div data-slot="form-item" className={cn('grid gap-2', className)} {...props} />
    </ItemContext.Provider>
  );
}

export function FormLabel({ className, ...props }: ComponentProps<typeof Label>) {
  const { error, formItemId } = useFormField();
  return (
    <Label
      data-slot="form-label"
      data-error={Boolean(error)}
      className={cn('data-[error=true]:text-danger', className)}
      htmlFor={formItemId}
      {...props}
    />
  );
}

export function FormControl(props: ComponentProps<typeof Slot.Root>) {
  const { error, formItemId, formDescriptionId, formMessageId } = useFormField();
  return (
    <Slot.Root
      data-slot="form-control"
      id={formItemId}
      aria-describedby={error ? `${formDescriptionId} ${formMessageId}` : formDescriptionId}
      aria-invalid={Boolean(error)}
      {...props}
    />
  );
}

export function FormDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const { formDescriptionId } = useFormField();
  return (
    <p
      data-slot="form-description"
      id={formDescriptionId}
      className={cn('text-sm text-fg-muted', className)}
      {...props}
    />
  );
}

export function FormMessage({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  const { t } = useTranslation('ui');
  const { error, formMessageId } = useFormField();
  const message = error?.message;
  if (!message) return null;

  return (
    <p
      data-slot="form-message"
      id={formMessageId}
      className={cn('text-sm font-medium text-danger', className)}
      {...props}
    >
      {isValidationKey(message) ? t(message) : t('validation.invalid')}
    </p>
  );
}
