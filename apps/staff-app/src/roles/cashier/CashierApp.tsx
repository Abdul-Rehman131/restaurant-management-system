// Loaded only inside the signed-in shell: importing it ties the shell's modules (data
// client, TanStack Query, settings) to the shell chunk instead of splitting them into shared
// chunks the shell would download as extra files (plan 4.10 budgets).
import '../../shell/SignedIn';
import './i18n';

import { Badge, Button, EmptyState, OfflineBanner, cn } from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import { Keyboard, MousePointerClick, Play, Plus, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Route, Routes, useMatch, useNavigate } from 'react-router';

import { playTones, reacquireWakeLockOnReturn, releaseWakeLock, startShift } from '../../lib/shift';
import { paths } from '../../paths';
import { useConnection } from '../../shell/connection-context';
import { StaffHeader } from '../../shell/StaffHeader';
import { useScreenAppearance } from '../../shell/theme-context';
import { BillDetail } from './BillDetail';
import { BillList } from './BillList';
import { CounterOrder } from './CounterOrder';
import { newBillRequests, requestedBills } from './bills';
import { billsQuery } from './data';
import { Kbd } from './Kbd';
import { useCashierLive } from './live';
import { cashierPaths, cashierRoutes } from './paths';
import { ShortcutSheet } from './ShortcutSheet';
import { useCashierStore } from './store';

/** The bill-request tone: two soft low notes, unlike the kitchen chime and the Ready tone. */
function playSoftTone() {
  playTones([
    [0, 523],
    [0.22, 659],
  ]);
}

function ShiftControl() {
  const { t } = useTranslation(['cashier', 'rpc']);
  const shiftStarted = useCashierStore((s) => s.shiftStarted);
  const muted = useCashierStore((s) => s.muted);
  const setMuted = useCashierStore((s) => s.setMuted);
  const setShiftStarted = useCashierStore((s) => s.setShiftStarted);
  if (!shiftStarted) {
    return (
      <Button
        variant="outline"
        onClick={() => {
          void startShift().then(({ wakeLock }) => {
            setShiftStarted(wakeLock);
          });
        }}
      >
        <Play aria-hidden />
        {t('cashier:startShift')}
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      className={cn(muted && 'text-danger')}
      aria-pressed={muted}
      aria-label={muted ? t('cashier:unmute') : t('cashier:mute')}
      onClick={() => {
        setMuted(!muted);
      }}
    >
      {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
      <span aria-hidden className="max-lg:hidden">
        {muted ? t('cashier:muted') : t('cashier:soundOn')}
      </span>
    </Button>
  );
}

/** A new bill request: the soft tone (after Start shift, unless muted) and the badge. */
function useBillRequestAlerts(): void {
  const { data } = useQuery(billsQuery);
  useEffect(() => {
    if (!data) return;
    const { knownRequests, rememberRequests, muted } = useCashierStore.getState();
    if (!knownRequests) {
      rememberRequests(requestedBills(data), false);
      return;
    }
    const fresh = newBillRequests(knownRequests, data);
    if (fresh.length === 0) return;
    rememberRequests(fresh, true);
    if (!muted) playSoftTone();
  }, [data]);
}

/** Shortcut keys announced on their buttons (aria-keyshortcuts). */
const keyNew = 'n';
const keyHelp = '?';

/** True when a dialog or sheet is open: its own keys (Escape, Tab) win. */
const overlayOpen = () =>
  document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"]') !== null;

/**
 * Cashier (M7): desk density, split screen from lg (38% open bills, 62% bill detail and
 * payment); under lg the list, then the detail with a back button (plan 4.5). Admin may use
 * it too. Keyboard shortcuts as in plan 4.8.
 */
export function CashierApp() {
  const { t } = useTranslation(['cashier', 'rpc']);
  const { state, canSend } = useConnection();
  const navigate = useNavigate();
  const billsId = useId();
  useScreenAppearance({ density: 'desk' });
  useCashierLive();
  useBillRequestAlerts();
  const announced = useCashierStore((s) => s.lastRequest);
  const bills = useQuery(billsQuery);
  const unread = useCashierStore((s) => s.unreadRequests.size);
  const shiftStarted = useCashierStore((s) => s.shiftStarted);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const billMatch = useMatch(`${paths.cashier}/bill/:orderId`);
  const newMatch = useMatch(`${paths.cashier}/new`);
  const selectedId = billMatch?.params.orderId ?? null;
  const inDetail = billMatch !== null || newMatch !== null;
  const announcedBill = bills.data?.find((bill) => bill.order_id === announced);

  // Keep the screen awake for the whole shift (R10).
  useEffect(() => {
    if (!shiftStarted) return;
    const stop = reacquireWakeLockOnReturn();
    return () => {
      stop();
      releaseWakeLock();
    };
  }, [shiftStarted]);

  // Keyboard shortcuts (plan 4.8). Typing in a field never triggers one, except Ctrl+P.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { shortcuts } = useCashierStore.getState();
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') {
        if (shortcuts.print) {
          event.preventDefault();
          shortcuts.print();
        }
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || overlayOpen()) return;
      const target = event.target as HTMLElement | null;
      const typing = target?.closest('input, textarea, select, [contenteditable="true"]');
      if (event.key === 'Escape') {
        if (typing) {
          (typing as HTMLElement).blur();
          return;
        }
        if (inDetail) void navigate(cashierPaths.bills);
        return;
      }
      if (typing) return;
      const rows = [...document.querySelectorAll<HTMLElement>('[data-bill-row]')];
      const run = (action?: () => void) => {
        if (!action) return;
        event.preventDefault();
        action();
      };
      switch (event.key) {
        case '/':
          event.preventDefault();
          document.getElementById('cashier-search')?.focus();
          break;
        case 'ArrowDown':
        case 'ArrowUp': {
          if (rows.length === 0) return;
          event.preventDefault();
          const current = rows.findIndex(
            (row) => row === document.activeElement || row.getAttribute('aria-current') === 'page',
          );
          const step = event.key === 'ArrowDown' ? 1 : -1;
          const next = current < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, current + step));
          rows[next]?.focus();
          break;
        }
        case 'n':
        case 'N':
          if (canSend) run(() => void navigate(cashierPaths.newOrder));
          break;
        case 'p':
        case 'P':
          run(shortcuts.pay);
          break;
        case '1':
          run(shortcuts.cashFull);
          break;
        case '2':
          run(shortcuts.cardFull);
          break;
        case 's':
        case 'S':
          run(shortcuts.split);
          break;
        case '?':
          run(() => {
            setShortcutsOpen(true);
          });
          break;
      }
    };
    // Capture phase: this runs before a dialog handles the key, so an Escape that closes a
    // dialog (seen while it is still open) never also leaves the bill.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
    };
  }, [navigate, inDetail, canSend]);

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <StaffHeader
        actions={
          <>
            {unread > 0 && (
              <Badge variant="accent" className="h-8 px-3 text-sm" aria-live="polite">
                {t('cashier:billRequestsBadge', { count: unread })}
              </Badge>
            )}
            <ShiftControl />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('cashier:shortcuts')}
              title={t('cashier:shortcutsHint')}
              aria-keyshortcuts={keyHelp}
              onClick={() => {
                setShortcutsOpen(true);
              }}
              className="max-sm:hidden"
            >
              <Keyboard aria-hidden />
            </Button>
            <Button
              disabled={!canSend}
              aria-keyshortcuts={keyNew}
              className="max-sm:hidden"
              onClick={() => void navigate(cashierPaths.newOrder)}
            >
              <Plus aria-hidden />
              {t('cashier:newCounterOrder')}
              <Kbd>N</Kbd>
            </Button>
          </>
        }
      />
      <OfflineBanner online={state !== 'offline'} />
      <p aria-live="polite" className="sr-only">
        {announcedBill
          ? t('cashier:billRequestedAnnounce', { bill: announcedBill.order_number })
          : ''}
      </p>
      <h1 className="sr-only">{t('cashier:title')}</h1>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[38fr_62fr]">
        <section
          aria-labelledby={billsId}
          className={cn(
            'min-h-0 flex-col border-border bg-surface lg:flex lg:border-e',
            inDetail ? 'hidden' : 'flex',
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 id={billsId} className="text-lg font-semibold">
              {t('cashier:openBills')}
            </h2>
            <Button
              size="sm"
              disabled={!canSend}
              className="sm:hidden"
              aria-label={t('cashier:newCounterOrder')}
              onClick={() => void navigate(cashierPaths.newOrder)}
            >
              <Plus aria-hidden />
            </Button>
          </div>
          <BillList selectedId={selectedId} />
        </section>
        <section className={cn('min-h-0 overflow-y-auto lg:block', inDetail ? 'block' : 'hidden')}>
          <Routes>
            <Route
              index
              element={
                <EmptyState
                  icon={MousePointerClick}
                  title={t('cashier:detailEmpty')}
                  description={t('cashier:detailEmptyBody')}
                  className="h-full justify-center"
                />
              }
            />
            <Route path={cashierRoutes.bill} element={<BillDetail />} />
            <Route path={cashierRoutes.newOrder} element={<CounterOrder />} />
          </Routes>
        </section>
      </div>
      <ShortcutSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}

export { CashierApp as Component };
