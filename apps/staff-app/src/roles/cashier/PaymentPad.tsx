import { usePublicSettings } from '@rms/shared';
import { Button, Input, Label, MoneyText, cn } from '@rms/ui';
import { Banknote, CircleAlert, CreditCard, Split } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { RpcAction } from '../../lib/useRpcAction';
import { useConnection } from '../../shell/connection-context';
import { Kbd } from './Kbd';
import { amountToInput, changeDue, parseAmount, quickCash, toTenders, type Tender } from './pay';
import { useCashierStore } from './store';

type Method = 'cash' | 'card' | 'split';

const keyPay = 'p';

const methods: { method: Method; icon: typeof Banknote; key: string }[] = [
  { method: 'cash', icon: Banknote, key: '1' },
  { method: 'card', icon: CreditCard, key: '2' },
  { method: 'split', icon: Split, key: 'S' },
];

function AmountField({
  id,
  label,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  describedBy?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="text-lg tabular-nums"
      />
    </div>
  );
}

/**
 * The payment pad (plan 4.9, 4.11; BR-11): Cash with the amount received, quick-cash buttons
 * and the change due in large type; Card with an optional reference; or Split. Amounts are
 * typed as text and parsed to integer minor units (pay.ts); the server checks the tenders
 * again and writes nothing unless they add up exactly (record_payment). The amount due comes
 * from the server (get_open_bills).
 */
export function PaymentPad({
  due,
  action,
}: {
  /** The amount due from the server, in minor units. */
  due: number;
  action: RpcAction<[Tender[]]>;
}) {
  const { t } = useTranslation(['cashier', 'rpc']);
  const { settings } = usePublicSettings();
  const { canSend } = useConnection();
  const setShortcuts = useCashierStore((s) => s.setShortcuts);
  const minor = settings?.currencyMinorUnits ?? 2;
  const ids = {
    received: useId(),
    reference: useId(),
    cash: useId(),
    card: useId(),
    hint: useId(),
  };

  const [method, setMethod] = useState<Method>('cash');
  const [received, setReceived] = useState(() => amountToInput(due, minor));
  const [reference, setReference] = useState('');
  const [cashPart, setCashPart] = useState('');
  const [cardPart, setCardPart] = useState(() => amountToInput(due, minor));

  const receivedAmount = parseAmount(received, minor);
  const cashAmount = parseAmount(cashPart, minor);
  const cardAmount = parseAmount(cardPart, minor);
  const change = changeDue(method === 'split' ? (cashAmount ?? 0) : due, receivedAmount);

  const tenders = (): Tender[] | null => {
    if (method === 'cash') {
      if (receivedAmount === null) return null;
      return toTenders({ cash: { amount: due, tendered: receivedAmount }, card: null });
    }
    if (method === 'card') return toTenders({ cash: null, card: { amount: due, reference } });
    if (cashAmount === null || cardAmount === null) return null;
    return toTenders({
      cash: { amount: cashAmount, tendered: receivedAmount ?? cashAmount },
      card: { amount: cardAmount, reference },
    });
  };
  const ready = tenders();
  const pay = () => {
    const list = tenders();
    if (list && list.length > 0) void action.run(list);
  };

  const choose = (next: Method) => {
    action.clearError();
    setMethod(next);
    if (next === 'cash') setReceived(amountToInput(due, minor));
    if (next === 'card') setReference('');
    if (next === 'split') {
      setCashPart('');
      setCardPart(amountToInput(due, minor));
      setReceived('');
    }
  };

  // Keys 1, 2, S and P (plan 4.8), while this bill is open.
  useEffect(() => {
    setShortcuts({
      cashFull: () => {
        choose('cash');
      },
      cardFull: () => {
        choose('card');
      },
      split: () => {
        choose('split');
      },
      pay,
    });
    return () => {
      setShortcuts({ cashFull: undefined, cardFull: undefined, split: undefined, pay: undefined });
    };
  });

  return (
    <section
      aria-labelledby="payment-heading"
      className="space-y-4 rounded-lg border border-border bg-surface p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="payment-heading" className="text-lg font-semibold">
          {t('cashier:amountDue')}
        </h2>
        <MoneyText amount={due} fraction="always" className="text-2xl font-bold" />
      </div>

      <div role="radiogroup" aria-label={t('cashier:method')} className="grid grid-cols-3 gap-2">
        {methods.map(({ method: m, icon: Icon, key }) => (
          <Button
            key={m}
            role="radio"
            aria-checked={method === m}
            variant={method === m ? 'secondary' : 'outline'}
            className={cn(method === m && 'ring-2 ring-brand')}
            aria-keyshortcuts={key}
            onClick={() => {
              choose(m);
            }}
          >
            <Icon aria-hidden />
            {t(`cashier:${m}`)}
            <Kbd>{key}</Kbd>
          </Button>
        ))}
      </div>

      {method === 'cash' && (
        <div className="space-y-3">
          <AmountField
            id={ids.received}
            label={t('cashier:received')}
            value={received}
            onChange={(value) => {
              action.clearError();
              setReceived(value);
            }}
            invalid={receivedAmount === null || receivedAmount < due}
            describedBy={ids.hint}
          />
          <div className="flex flex-wrap gap-2">
            {quickCash(due, minor).map((amount, index) => (
              <Button
                key={amount}
                variant="outline"
                size="sm"
                onClick={() => {
                  action.clearError();
                  setReceived(amountToInput(amount, minor));
                }}
              >
                {index === 0 ? t('cashier:exact') : <MoneyText amount={amount} />}
              </Button>
            ))}
          </div>
        </div>
      )}

      {method === 'split' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <AmountField
            id={ids.cash}
            label={t('cashier:cashPart')}
            value={cashPart}
            onChange={(value) => {
              action.clearError();
              setCashPart(value);
              // A convenience only: the card part starts at what is left. The server checks
              // that the parts add up (PAYMENT_MISMATCH otherwise).
              const cash = parseAmount(value, minor);
              if (cash !== null && cash <= due) setCardPart(amountToInput(due - cash, minor));
            }}
            invalid={cashPart !== '' && cashAmount === null}
            describedBy={ids.hint}
          />
          <AmountField
            id={ids.card}
            label={t('cashier:cardPart')}
            value={cardPart}
            onChange={(value) => {
              action.clearError();
              setCardPart(value);
            }}
            invalid={cardAmount === null}
            describedBy={ids.hint}
          />
          <AmountField
            id={ids.received}
            label={t('cashier:received')}
            value={received}
            onChange={(value) => {
              action.clearError();
              setReceived(value);
            }}
            invalid={received !== '' && receivedAmount === null}
          />
        </div>
      )}

      {(method === 'card' || method === 'split') && (
        <div className="space-y-1.5">
          <Label htmlFor={ids.reference}>{t('cashier:cardReference')}</Label>
          <Input
            id={ids.reference}
            value={reference}
            maxLength={64}
            autoComplete="off"
            onChange={(event) => {
              setReference(event.target.value);
            }}
          />
        </div>
      )}

      <p id={ids.hint} className="text-sm text-fg-muted">
        {method === 'split' ? t('cashier:splitHint') : null}
        {method === 'cash' && receivedAmount !== null && receivedAmount < due
          ? t('cashier:notEnoughCash')
          : null}
        {(method === 'cash' && receivedAmount === null) ||
        (method === 'split' && cashPart !== '' && cashAmount === null)
          ? t('cashier:invalidAmount')
          : null}
      </p>

      {(method === 'cash' || method === 'split') && change !== null && (
        <div className="flex items-baseline justify-between gap-3 rounded-md bg-success-bg px-4 py-3 text-success">
          <span className="text-lg font-semibold">{t('cashier:changeDue')}</span>
          <MoneyText
            amount={change}
            fraction="always"
            className="text-3xl font-bold"
            data-testid="change-due"
          />
        </div>
      )}

      {action.error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-bg p-3 text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t(action.error)}
        </p>
      )}

      <Button
        size="lg"
        className="w-full"
        loading={action.pending}
        disabled={!canSend || !ready || ready.length === 0}
        aria-keyshortcuts={keyPay}
        onClick={pay}
      >
        {t('cashier:pay')}
        <Kbd>P</Kbd>
      </Button>
    </section>
  );
}
