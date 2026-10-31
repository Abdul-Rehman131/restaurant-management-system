import { Button } from '@rms/ui';
import { BellRing, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { ShiftControl } from '../../shift/ShiftControl';
import { useAlertStore } from './alerts';
import { batchLabel, useTableNumber } from './format';
import { waiterPaths } from './paths';

/** Header control: Start shift / Shift on and the Ready tone's mute toggle (shared control). */
export function WaiterShift() {
  const { t } = useTranslation('waiter');
  const muted = useAlertStore((state) => state.muted);
  const setMuted = useAlertStore((state) => state.setMuted);
  return (
    <ShiftControl
      shift="waiter"
      muted={muted}
      onMutedChange={setMuted}
      muteLabel={t('mute')}
      unmuteLabel={t('unmute')}
    />
  );
}

/**
 * The Ready banner (plan 4.6 rule 6): under the header on every waiter screen until it is
 * opened or dismissed. Announced politely (plan 4.7); it only fades in, so it respects
 * prefers-reduced-motion.
 */
export function ReadyBanner() {
  const { t } = useTranslation(['waiter', 'rpc']);
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
              {t('waiter:readyTitle', { number: tableNumber(alert.tableId) })}
            </span>
            <span className="block text-sm">
              {t('waiter:readyAlert', { batch: batchLabel(t, alert.batchNo) })}
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
            {t('waiter:open')}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-success"
            aria-label={t('waiter:dismiss')}
            onClick={dismiss}
          >
            <X aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
