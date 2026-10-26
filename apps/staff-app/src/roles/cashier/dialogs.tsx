import { parseAmount, usePublicSettings } from '@rms/shared';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@rms/ui';
import { CircleAlert } from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { RpcErrorKey } from '../../lib/rpc';
import { useConnection } from '../../shell/connection-context';

/** The longest reason the server keeps (private.require_reason). */
const MAX_REASON = 300;

function ErrorLine({ error }: { error: RpcErrorKey | null }) {
  const { t } = useTranslation(['cashier', 'rpc']);
  if (!error) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-bg p-3 text-danger">
      <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
      {t(error)}
    </p>
  );
}

function ReasonField({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation(['cashier', 'rpc']);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{t('cashier:reasonLabel')}</Label>
      <Textarea
        id={id}
        required
        value={value}
        maxLength={MAX_REASON}
        placeholder={t('cashier:reasonPlaceholder')}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

/**
 * ReasonDialog (plan 4.4, 4.6 rule 5): a destructive action (cancel a line or the order,
 * void a payment) asks for confirmation and a required reason (BR-09, BR-24). The dialog
 * closes only when the server confirms.
 */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error: RpcErrorKey | null;
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const { t } = useTranslation(['cashier', 'rpc']);
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
        <ReasonField id={id} value={reason} onChange={setReason} />
        <ErrorLine error={error} />
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cashier:keep')}</AlertDialogCancel>
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

/** Admin only (BR-10): a fixed discount in minor units with a reason; 0 removes it. */
export function DiscountDialog({
  open,
  onOpenChange,
  title,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  pending: boolean;
  error: RpcErrorKey | null;
  onConfirm: (amount: number, reason: string) => Promise<boolean>;
}) {
  const { t } = useTranslation(['cashier', 'rpc']);
  const { settings } = usePublicSettings();
  const { canSend } = useConnection();
  const ids = { amount: useId(), reason: useId() };
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const amount = parseAmount(amountText, settings?.currencyMinorUnits ?? 2);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('cashier:discountBody')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={ids.amount}>{t('cashier:discountAmount')}</Label>
          <Input
            id={ids.amount}
            inputMode="decimal"
            autoComplete="off"
            value={amountText}
            aria-invalid={(amountText !== '' && amount === null) || undefined}
            onChange={(event) => {
              setAmountText(event.target.value);
            }}
          />
        </div>
        <ReasonField id={ids.reason} value={reason} onChange={setReason} />
        <ErrorLine error={error} />
        <DialogFooter>
          <Button
            loading={pending}
            disabled={!canSend || amount === null || reason.trim() === ''}
            onClick={() => {
              if (amount === null) return;
              void onConfirm(amount, reason.trim()).then((done) => {
                if (done) {
                  setAmountText('');
                  setReason('');
                  onOpenChange(false);
                }
              });
            }}
          >
            {t('cashier:discountApply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A native select with a label: reliable with the keyboard and screen readers. */
export function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="h-control-md w-full rounded-md border border-input bg-surface px-3 text-fg focus-visible:outline-2 focus-visible:outline-ring"
      >
        {children}
      </select>
    </div>
  );
}
