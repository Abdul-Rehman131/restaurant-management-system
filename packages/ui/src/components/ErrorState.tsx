import { CircleAlert, RotateCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn';
import { Button } from './Button';

export interface ErrorStateProps {
  /** What happened, in plain words (mapped from the RPC error code, never raw text). */
  title: string;
  /** What to do next. */
  description: string;
  onRetry?: () => void;
  /** Defaults to "Try again". */
  retryLabel?: string;
  retrying?: boolean;
  className?: string;
}

/** Something failed: what happened, what to do, Retry (plan 4.4 and 4.6 rule 4). */
export function ErrorState({
  title,
  description,
  onRetry,
  retryLabel,
  retrying = false,
  className,
}: ErrorStateProps) {
  const { t } = useTranslation('ui');
  return (
    <div
      role="alert"
      data-slot="error-state"
      className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}
    >
      <span className="grid size-14 place-items-center rounded-full bg-danger-bg text-danger">
        <CircleAlert aria-hidden className="size-7" />
      </span>
      <p className="text-lg font-semibold">{title}</p>
      <p className="max-w-sm text-fg-muted">{description}</p>
      {onRetry && (
        <Button variant="outline" className="mt-2" loading={retrying} onClick={onRetry}>
          <RotateCw aria-hidden />
          {retryLabel ?? t('error.retry')}
        </Button>
      )}
    </div>
  );
}
