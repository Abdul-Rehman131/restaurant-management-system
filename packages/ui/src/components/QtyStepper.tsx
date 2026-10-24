import { Minus, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn';
import { Button } from './Button';

export interface QtyStepperProps {
  value: number;
  onChange: (value: number) => void;
  /** Item name, used in the accessible labels ("Quantity of Garlic Naan"). */
  itemName: string;
  /** The server accepts 1 to 99 per line (create_order). */
  min?: number;
  max?: number;
  /** At the minimum, the minus button becomes Remove (cart lines before Send). */
  onRemove?: () => void;
  disabled?: boolean;
  className?: string;
}

/** Quantity control for cart lines: large targets, one tap per change (plan 4.6 rule 9). */
export function QtyStepper({
  value,
  onChange,
  itemName,
  min = 1,
  max = 99,
  onRemove,
  disabled = false,
  className,
}: QtyStepperProps) {
  const { t } = useTranslation('ui');
  const atMin = value <= min;
  const canRemove = atMin && onRemove !== undefined;

  return (
    <div
      role="group"
      aria-label={t('qty.label', { item: itemName })}
      className={cn('inline-flex items-center gap-1 rounded-md bg-surface-2 p-1', className)}
    >
      <Button
        variant="ghost"
        size="icon"
        className={cn('bg-surface', canRemove && 'text-danger')}
        disabled={disabled || (atMin && !canRemove)}
        aria-label={canRemove ? t('qty.remove', { item: itemName }) : t('qty.decrease')}
        onClick={() => {
          if (canRemove) onRemove();
          else onChange(Math.max(min, value - 1));
        }}
      >
        {canRemove ? <Trash2 aria-hidden /> : <Minus aria-hidden />}
      </Button>
      <output
        aria-live="polite"
        className="min-w-10 text-center text-lg font-semibold tabular-nums"
      >
        {value}
      </output>
      <Button
        variant="ghost"
        size="icon"
        className="bg-surface"
        disabled={disabled || value >= max}
        aria-label={t('qty.increase')}
        onClick={() => {
          onChange(Math.min(max, value + 1));
        }}
      >
        <Plus aria-hidden />
      </Button>
    </div>
  );
}
