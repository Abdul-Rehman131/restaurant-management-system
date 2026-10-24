import { formatMoney, usePublicSettings, type MinorUnits } from '@rms/shared';
import type { HTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn';
import { Skeleton } from './Skeleton';

export interface MoneyTextProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  /** Integer amount in the smallest currency unit (paisa). Never a float or a formatted string. */
  amount: MinorUnits;
  /** "always" keeps ".00" (receipts, payment pad); "auto" hides it on whole amounts. */
  fraction?: 'auto' | 'always';
}

/**
 * The ONE way an amount reaches the screen. Currency and minor units come from settings
 * (never hardcoded); digits are tabular so columns and totals line up. A non-integer amount
 * throws: it means a price was computed on the client, which is never allowed (BR-01).
 */
export function MoneyText({ amount, fraction = 'auto', className, ...props }: MoneyTextProps) {
  const { i18n, t } = useTranslation('ui');
  const { settings } = usePublicSettings();

  if (!settings) {
    return (
      <span className={cn('inline-flex align-middle', className)} {...props}>
        <Skeleton className="h-[1em] w-16" />
        <span className="sr-only">{t('common.loading')}</span>
      </span>
    );
  }

  return (
    <span
      data-slot="money"
      // An amount is one left-to-right unit, also inside RTL text: "-Rs 48" never becomes "Rs 48-".
      dir="ltr"
      className={cn('whitespace-nowrap tabular-nums', className)}
      {...props}
    >
      {formatMoney(amount, {
        currencyCode: settings.currencyCode,
        minorUnits: settings.currencyMinorUnits,
        locale: i18n.language,
        fraction,
      })}
    </span>
  );
}
