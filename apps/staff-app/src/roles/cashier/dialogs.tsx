import { parseAmount, usePublicSettings } from '@rms/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@rms/ui';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  ErrorLine,
  ReasonField,
  ReasonDialog as SharedReasonDialog,
} from '../../dialogs/ReasonDialog';
import type { RpcErrorKey } from '../../lib/rpc';
import { useConnection } from '../../shell/connection-context';

export { SelectField } from '../../dialogs/ReasonDialog';

/**
 * ReasonDialog (plan 4.4, 4.6 rule 5) with the cashier's words: cancel a line or the order,
 * void a payment (BR-09, BR-24). The dialog itself is shared with the admin screens.
 */
export function ReasonDialog(
  props: Omit<Parameters<typeof SharedReasonDialog>[0], 'labels' | 'children'>,
) {
  const { t } = useTranslation(['cashier', 'rpc']);
  return (
    <SharedReasonDialog
      {...props}
      labels={{
        reason: t('cashier:reasonLabel'),
        placeholder: t('cashier:reasonPlaceholder'),
        keep: t('cashier:keep'),
      }}
    />
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
        <ReasonField
          id={ids.reason}
          label={t('cashier:reasonLabel')}
          placeholder={t('cashier:reasonPlaceholder')}
          value={reason}
          onChange={setReason}
        />
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
