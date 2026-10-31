import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Label,
  Textarea,
} from '@rms/ui';
import { CircleAlert } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { RpcErrorKey } from '../lib/rpc';
import { useConnection } from '../shell/connection-context';

/**
 * Dialog parts shared by the role chunks that confirm destructive actions (cashier: cancel and
 * void; admin: archive and deactivate). Not part of the shell: each role passes its own words,
 * and the `rpc` namespace (error messages) loads with every role chunk.
 */

/** The longest reason the server keeps (private.require_reason). */
export const MAX_REASON = 300;

/** An RPC failure in plain words (plan 4.6 rule 4). */
export function ErrorLine({ error }: { error: RpcErrorKey | null }) {
  const { t } = useTranslation(['rpc']);
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-bg p-3 text-danger">
      <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
      {t(error)}
    </p>
  );
}

export function ReasonField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        required
        value={value}
        maxLength={MAX_REASON}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

export interface ReasonDialogLabels {
  reason: string;
  placeholder: string;
  keep: string;
}

/**
 * ReasonDialog (plan 4.4, 4.6 rule 5): a destructive action asks for confirmation and a
 * required reason (BR-09, BR-24). The dialog closes only when the server confirms. Disabled
 * offline.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  labels,
  pending,
  error,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  labels: ReasonDialogLabels;
  pending: boolean;
  error: RpcErrorKey | null;
  onConfirm: (reason: string) => Promise<boolean>;
  /** Extra content above the reason (e.g. what will happen). */
  children?: ReactNode;
}) {
  const { canSend } = useConnection();
  const id = useId();
  const [reason, setReason] = useState('');
  const blank = reason.trim() === '';
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason('');
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children}
        <ReasonField
          id={id}
          label={labels.reason}
          placeholder={labels.placeholder}
          value={reason}
          onChange={setReason}
        />
        <ErrorLine error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel>{labels.keep}</AlertDialogCancel>
          <Button
            variant="destructive"
            loading={pending}
            disabled={!canSend || blank}
            onClick={() => {
              void onConfirm(reason.trim()).then((done) => {
                if (done) {
                  setReason('');
                  onOpenChange(false);
                }
              });
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A native select with a label: reliable with the keyboard and screen readers. */
export function SelectField({
  label,
  value,
  onChange,
  children,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
  hint?: string | undefined;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-control-md w-full rounded-md border border-input bg-surface px-3 text-fg focus-visible:outline-2 focus-visible:outline-ring"
      >
        {children}
      </select>
      {hint && (
        <p id={hintId} className="text-sm text-fg-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
