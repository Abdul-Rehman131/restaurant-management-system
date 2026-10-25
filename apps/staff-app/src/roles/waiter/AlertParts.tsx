import { Button, cn } from '@rms/ui';
import { BellRing, Play, Volume2, VolumeX, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { startShift, useAlertStore } from './alerts';
import { batchLabel, useTableNumber } from './format';
import { waiterPaths } from './paths';

/** Header control: Start shift (a tap unlocks sound, R10), then the visible mute toggle. */
export function ShiftControl() {
  const { t } = useTranslation();
  const shiftStarted = useAlertStore((state) => state.shiftStarted);
  const muted = useAlertStore((state) => state.muted);
  const setMuted = useAlertStore((state) => state.setMuted);
  const setShiftStarted = useAlertStore((state) => state.setShiftStarted);

  if (!shiftStarted) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="min-h-11"
        onClick={() => {
          void startShift().then(({ wakeLock }) => {
            setShiftStarted(true, wakeLock);
          });
        }}
      >
        <Play aria-hidden />
        {t('waiter.startShift')}
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn('min-h-11', muted && 'text-danger')}
      aria-pressed={muted}
      aria-label={muted ? t('waiter.unmute') : t('waiter.mute')}
      onClick={() => {
        setMuted(!muted);
      }}
    >
      {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
      <span aria-hidden className="text-sm">
        {muted ? t('waiter.muted') : t('waiter.soundOn')}
      </span>
    </Button>
  );
}

/**
 * The Ready banner (plan 4.6 rule 6): under the header on every waiter screen until it is
 * opened or dismissed. Announced politely (plan 4.7); it only fades in, so it respects
 * prefers-reduced-motion.
 */
export function ReadyBanner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const tableNumber = useTableNumber();
  const alert = useAlertStore((state) => state.alerts.find((a) => a.id === state.bannerId));
  const dismiss = useAlertStore((state) => state.dismissBanner);
  const markRead = useAlertStore((state) => state.markRead);

  return (
    <div aria-live="polite" className="sticky top-14 z-40">
      {alert && (
        <div className="flex items-center gap-3 border-b border-success/30 bg-success-bg px-4 py-2 text-success [--enter-y:-0.5rem] motion-safe:animate-enter">
          <BellRing aria-hidden className="size-6 shrink-0" />
          <p className="min-w-0 flex-1">
            <span className="block font-semibold">
              {t('waiter.readyTitle', { number: tableNumber(alert.tableId) })}
            </span>
            <span className="block text-sm">
              {t('waiter.readyAlert', { batch: batchLabel(t, alert.batchNo) })}
            </span>
          </p>
          <Button
            size="sm"
            className="min-h-11"
            onClick={() => {
              markRead(alert.id);
              if (alert.tableId) void navigate(waiterPaths.table(alert.tableId));
            }}
          >
            {t('waiter.open')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-success"
            aria-label={t('waiter.dismiss')}
            onClick={dismiss}
          >
            <X aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
