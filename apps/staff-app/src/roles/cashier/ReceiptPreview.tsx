import './receipt.css';

import { formatMoney, usePublicSettings } from '@rms/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Switch,
} from '@rms/ui';
import { Printer } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Kbd } from './Kbd';
import type { Receipt } from './receipt';
import { useCashierStore } from './store';

const totalLabel = {
  subtotal: 'cashier:subtotal',
  discount: 'cashier:discount',
  serviceCharge: 'cashier:serviceCharge',
  tax: 'cashier:tax',
  total: 'cashier:total',
} as const;

/** The receipt as printed: one narrow column, receipt-style (80 mm paper). */
export function ReceiptView({ receipt }: { receipt: Receipt }) {
  const { t, i18n } = useTranslation(['cashier', 'rpc']);
  const { settings } = usePublicSettings();
  if (!settings) return null;
  const money = (amount: number) =>
    formatMoney(amount, {
      currencyCode: settings.currencyCode,
      minorUnits: settings.currencyMinorUnits,
      locale: i18n.language,
      fraction: 'always',
    });

  return (
    <div data-receipt className="mx-auto w-full max-w-[80mm] space-y-2 font-mono text-sm">
      <div className="text-center">
        <p className="text-base font-bold">{receipt.restaurantName}</p>
        {receipt.address && <p>{receipt.address}</p>}
        {receipt.phone && <p>{receipt.phone}</p>}
      </div>
      <div className="border-t border-dashed border-current pt-2">
        <p>{t('cashier:receiptOrder', { number: receipt.orderNumber })}</p>
        <p>
          {receipt.date} {receipt.time}
        </p>
        <p>
          {receipt.servedTo.kind === 'table'
            ? t('cashier:receiptTable', { number: receipt.servedTo.table })
            : [t('cashier:receiptTakeAway'), receipt.servedTo.name].filter(Boolean).join(' · ')}
        </p>
      </div>
      <table className="w-full border-t border-dashed border-current">
        <tbody>
          {receipt.lines.map((line, index) => (
            <tr key={index} className="align-top">
              <td className="w-8 py-0.5">{line.quantity}×</td>
              <td className="py-0.5">{line.name}</td>
              <td className="py-0.5 text-end whitespace-nowrap" dir="ltr">
                {money(line.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="border-t border-dashed border-current pt-1">
        {receipt.totals.map((row) => (
          <div
            key={row.key}
            className={
              row.key === 'total'
                ? 'flex justify-between text-base font-bold'
                : 'flex justify-between'
            }
          >
            <dt>{t(totalLabel[row.key])}</dt>
            <dd dir="ltr">
              {row.key === 'discount' ? '−' : ''}
              {money(row.amount)}
            </dd>
          </div>
        ))}
      </dl>
      {receipt.payments.length > 0 && (
        <dl className="border-t border-dashed border-current pt-1">
          {receipt.payments.flatMap((p, index) => {
            const rows = [
              {
                label: [
                  t(`cashier:${p.method}`),
                  p.reference ? t('cashier:receiptReference', { reference: p.reference }) : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
                amount: p.amount,
              },
            ];
            if (p.tendered !== null) {
              rows.push({ label: t('cashier:receiptTendered'), amount: p.tendered });
              rows.push({ label: t('cashier:receiptChange'), amount: p.change ?? 0 });
            }
            return rows.map((row, rowIndex) => (
              <div key={`${String(index)}-${String(rowIndex)}`} className="flex justify-between">
                <dt>{row.label}</dt>
                <dd dir="ltr">{money(row.amount)}</dd>
              </div>
            ));
          })}
        </dl>
      )}
      {receipt.footer && (
        <p className="border-t border-dashed border-current pt-2 text-center">{receipt.footer}</p>
      )}
    </div>
  );
}

/** The receipt preview before printing (plan 4.9), with the per-device auto-print switch. */
export function ReceiptPreview({
  open,
  onOpenChange,
  receipt,
  onPrint,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  receipt: Receipt;
  onPrint: () => void;
}) {
  const { t } = useTranslation(['cashier', 'rpc']);
  const autoPrint = useCashierStore((s) => s.autoPrint);
  const setAutoPrint = useCashierStore((s) => s.setAutoPrint);
  const switchId = useId();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('cashier:receipt')}</DialogTitle>
          <DialogDescription>{receipt.orderNumber}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60dvh] overflow-y-auto rounded-md border border-border bg-surface p-4">
          <ReceiptView receipt={receipt} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor={switchId}>{t('cashier:autoPrint')}</Label>
          <Switch id={switchId} checked={autoPrint} onCheckedChange={setAutoPrint} />
        </div>
        <DialogFooter>
          <Button onClick={onPrint}>
            <Printer aria-hidden />
            {t('cashier:print')}
            <Kbd>{t('cashier:printShortcut')}</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
