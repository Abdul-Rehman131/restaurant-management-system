import { parseAmount, usePublicSettings, type rpc } from '@rms/shared';
import { Button, Card, CardContent, MoneyText } from '@rms/ui';
import { Calculator } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorLine, SelectField } from '../../dialogs/ReasonDialog';
import { rpcErrorKey, type RpcErrorKey } from '../../lib/rpc';
import { useConnection } from '../../shell/connection-context';
import { adminRpc } from './data';
import { parseLines } from './forms';
import { FormSection, PageHeader, TextField } from './ui';

type OrderType = 'dine_in' | 'take_away';
const types: OrderType[] = ['dine_in', 'take_away'];

/**
 * Bill check (S5): type the line amounts of a real bill and the order type, and see the
 * server's totals with the CURRENT settings (preview_bill_totals: the same formula as every
 * order, BR-01, BR-16). Nothing is saved: it is for comparing the owner's bills quickly.
 */
export function BillCheckScreen() {
  const { t } = useTranslation(['admin', 'rpc']);
  const { settings } = usePublicSettings();
  const { canSend } = useConnection();
  const linesId = useId();
  const minor = settings?.currencyMinorUnits ?? 2;
  const [type, setType] = useState<OrderType>('dine_in');
  const [linesText, setLinesText] = useState('');
  const [discountText, setDiscountText] = useState('0');
  const [result, setResult] = useState<rpc.BillCheckResponse | null>(null);
  const [error, setError] = useState<RpcErrorKey | null>(null);
  const [pending, setPending] = useState(false);

  const lines = parseLines(linesText, minor);
  const discount = discountText.trim() === '' ? 0 : parseAmount(discountText, minor);
  const linesInvalid = linesText.trim() !== '' && lines === null;

  async function check() {
    if (!lines || discount === null) return;
    setPending(true);
    setError(null);
    try {
      setResult(await adminRpc.billCheck(type, lines, discount));
    } catch (err) {
      setResult(null);
      setError(rpcErrorKey(err));
    } finally {
      setPending(false);
    }
  }

  const row = (label: string, amount: number, strong = false) => (
    <div
      className={
        strong
          ? 'flex justify-between border-t border-border pt-2 text-xl font-semibold'
          : 'flex justify-between'
      }
    >
      <dt>{label}</dt>
      <dd>
        <MoneyText amount={amount} fraction="always" />
      </dd>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin:billCheck.title')}
        description={t('admin:billCheck.description')}
      />
      <div className="mx-auto grid max-w-4xl gap-6 lg:grid-cols-2">
        <form
          noValidate
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault();
            void check();
          }}
        >
          <FormSection title={t('admin:billCheck.bill')}>
            <SelectField
              label={t('admin:billCheck.type')}
              value={type}
              onChange={(value) => {
                setType(value as OrderType);
                setResult(null);
              }}
            >
              {types.map((option) => (
                <option key={option} value={option}>
                  {t(`admin:orderType.${option}`)}
                </option>
              ))}
            </SelectField>
            <div className="grid gap-1.5">
              <label htmlFor={linesId} className="text-sm font-medium">
                {t('admin:billCheck.lines', { currency: settings?.currencyCode ?? '' })}
              </label>
              <textarea
                id={linesId}
                rows={6}
                value={linesText}
                inputMode="decimal"
                aria-invalid={linesInvalid || undefined}
                aria-describedby={`${linesId}-hint`}
                className="w-full rounded-md border border-input bg-surface px-3 py-2 text-fg tabular-nums focus-visible:outline-2 focus-visible:outline-ring"
                onChange={(event) => {
                  setLinesText(event.target.value);
                  setResult(null);
                }}
              />
              <p id={`${linesId}-hint`} className="text-sm text-fg-muted">
                {linesInvalid ? t('admin:billCheck.linesInvalid') : t('admin:billCheck.linesHint')}
              </p>
            </div>
            <TextField
              label={t('admin:billCheck.discount', { currency: settings?.currencyCode ?? '' })}
              inputMode="decimal"
              autoComplete="off"
              value={discountText}
              onChange={(event) => {
                setDiscountText(event.target.value);
                setResult(null);
              }}
            />
            <Button
              type="submit"
              loading={pending}
              disabled={!canSend || !lines || discount === null}
            >
              <Calculator aria-hidden />
              {t('admin:billCheck.check')}
            </Button>
            <ErrorLine error={error} />
          </FormSection>
        </form>
        <Card aria-live="polite">
          <CardContent className="space-y-4 p-6">
            <h2 className="text-lg font-semibold">{t('admin:billCheck.result')}</h2>
            {result ? (
              <>
                <dl className="space-y-2 tabular-nums">
                  {row(
                    t('admin:billCheck.subtotal', { count: result.line_count }),
                    result.subtotal,
                  )}
                  {result.discount > 0 && row(t('admin:billCheck.discountRow'), result.discount)}
                  {row(t('admin:billCheck.serviceCharge'), result.service_charge)}
                  {row(t('admin:billCheck.tax'), result.tax)}
                  {row(t('admin:billCheck.total'), result.total, true)}
                </dl>
                <p className="text-sm text-fg-muted">{t('admin:billCheck.basis')}</p>
              </>
            ) : (
              <p className="text-fg-muted">{t('admin:billCheck.empty')}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
