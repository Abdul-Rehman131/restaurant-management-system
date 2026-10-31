import { Badge, Button, EmptyState } from '@rms/ui';
import { BellRing, Moon, Play, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { beginShift, useWakeText } from '../../shift/lifecycle';
import { useShiftStore } from '../../shift/store';
import { useAlertStore } from './alerts';
import { batchLabel, useTableNumber } from './format';
import { waiterPaths } from './paths';

/** Alerts tab: Start shift, sound and wake-lock state, and the Ready alerts of this shift. */
export function AlertsScreen() {
  const { t, i18n } = useTranslation(['waiter', 'shift', 'rpc']);
  const tableNumber = useTableNumber();
  const alerts = useAlertStore((state) => state.alerts);
  const shiftStarted = useShiftStore((state) => state.on.waiter);
  const wake = useShiftStore((state) => state.wake);
  const wakeText = useWakeText();
  const muted = useAlertStore((state) => state.muted);
  const markRead = useAlertStore((state) => state.markRead);
  const markAllRead = useAlertStore((state) => state.markAllRead);
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-4 pt-4 pb-6">
      <h1 className="text-xl font-semibold">{t('waiter:alerts')}</h1>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        {shiftStarted ? (
          <>
            <h2 className="font-semibold">{t('shift:on')}</h2>
            <p className="mt-1 flex items-start gap-2 text-sm text-fg-muted">
              {wake === 'on' ? (
                <Sun aria-hidden className="size-4 shrink-0" />
              ) : (
                <Moon aria-hidden className="size-4 shrink-0" />
              )}
              {wakeText}
            </p>
          </>
        ) : (
          <>
            <h2 className="font-semibold">{t('shift:start')}</h2>
            <p className="mt-1 text-sm text-fg-muted">{t('waiter:startShiftBody')}</p>
            <Button
              size="lg"
              className="mt-3 w-full"
              onClick={() => {
                beginShift(
                  'waiter',
                  muted,
                  t('shift:started'),
                  muted ? t('shift:startedMuted') : t('shift:startedSound'),
                );
              }}
            >
              <Play aria-hidden />
              {t('shift:start')}
            </Button>
          </>
        )}
      </section>

      {alerts.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title={t('waiter:alertsEmpty')}
          description={t('waiter:alertsEmptyBody')}
        />
      ) : (
        <>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" className="min-h-11" onClick={markAllRead}>
              {t('waiter:markAllRead')}
            </Button>
          </div>
          <ul className="space-y-3">
            {alerts.map((alert) => (
              <li key={alert.id}>
                <Link
                  to={alert.tableId ? waiterPaths.table(alert.tableId) : waiterPaths.tables}
                  onClick={() => {
                    markRead(alert.id);
                  }}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm hover:bg-surface-2"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success-bg text-success">
                    <BellRing aria-hidden className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {t('waiter:readyTitle', { number: tableNumber(alert.tableId) })}
                    </span>
                    <span className="block text-sm text-fg-muted">
                      {t('waiter:readyAlert', { batch: batchLabel(t, alert.batchNo) })} ·{' '}
                      <time dateTime={new Date(alert.at).toISOString()}>
                        {time.format(alert.at)}
                      </time>
                    </span>
                  </span>
                  {!alert.read && <Badge variant="accent">{t('waiter:newAlert')}</Badge>}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
