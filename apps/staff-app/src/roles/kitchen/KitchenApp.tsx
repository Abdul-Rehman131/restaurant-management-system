// Loaded only inside the signed-in shell: importing it ties the shell's modules (data
// client, TanStack Query, settings) to the shell chunk instead of splitting them into shared
// chunks the shell would download as extra files (plan 4.10 budgets).
import '../../shell/SignedIn';
import './i18n';

import { usePublicSettings } from '@rms/shared';
import {
  Badge,
  Button,
  ConnectionDot,
  EmptyState,
  ErrorState,
  OfflineBanner,
  SkeletonCard,
} from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import { CheckCheck, ChefHat, ListX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { playTones } from '../../lib/shift';
import { Clock } from '../../shell/Clock';
import { useConnection } from '../../shell/connection-context';
import { AccountMenu } from '../../shell/StaffHeader';
import { useScreenAppearance } from '../../shell/theme-context';
import { useShiftLifecycle } from '../../shift/lifecycle';
import { ShiftControl } from '../../shift/ShiftControl';
import { queueQuery } from './data';
import { useNow, useTicketName } from './format';
import { useKitchenLive } from './live';
import { READY_LINGER_MS, newTickets, sortTickets, ticketAge, type Ticket } from './queue';
import { SoldOutSheet } from './SoldOutSheet';
import { useKitchenStore } from './store';
import { TicketCard } from './TicketCard';

/** The new-ticket chime: three quick notes, unlike the waiter's Ready tone. */
function playChime() {
  playTones([
    [0, 784],
    [0.12, 1047],
    [0.24, 1319],
  ]);
}

/** How long a new ticket keeps its highlight ring. */
const HIGHLIGHT_MS = 1_500;

/** Start shift / Shift on and the chime's mute toggle (the shared shift control). */
function KitchenShift() {
  const { t } = useTranslation('kitchen');
  const muted = useKitchenStore((s) => s.muted);
  const setMuted = useKitchenStore((s) => s.setMuted);
  return (
    <ShiftControl
      shift="kitchen"
      muted={muted}
      onMutedChange={setMuted}
      muteLabel={t('mute')}
      unmuteLabel={t('unmute')}
    />
  );
}

/**
 * Kitchen (M6, plan 4.11): full screen, always dark, display density, readable from 3 m.
 * One card per batch, oldest first, from get_kitchen_queue only (no money field, G6); Start,
 * then Ready. A Ready ticket stays a few seconds, then moves to the Recently ready strip.
 * New tickets chime once and slide in once. Live through staff:kitchen and staff:menu.
 */
export function KitchenApp() {
  const { t, i18n } = useTranslation(['kitchen', 'rpc']);
  const { settings } = usePublicSettings();
  const { state, canSend } = useConnection();
  useScreenAppearance({ theme: 'dark', density: 'display' });
  useKitchenLive();

  const queue = useQuery(queueQuery);
  const ticketName = useTicketName();
  const now = useNow(15_000);
  const [soldOutOpen, setSoldOutOpen] = useState(false);
  const recentlyReady = useKitchenStore((s) => s.recentlyReady);
  const markedReady = useKitchenStore((s) => s.markedReady);

  // Ready on this screen: kept on the board a few seconds so a mistaken tap is seen.
  const [lingering, setLingering] = useState<
    ReadonlyMap<string, { ticket: Ticket; until: number }>
  >(new Map());
  const onReady = useCallback(
    (ticket: Ticket) => {
      const at = Date.now();
      markedReady(ticket, at);
      setLingering((map) =>
        new Map(map).set(ticket.batch_id, { ticket, until: at + READY_LINGER_MS }),
      );
    },
    [markedReady],
  );
  useEffect(() => {
    if (lingering.size === 0) return;
    const next = Math.min(...[...lingering.values()].map((l) => l.until));
    const timer = window.setTimeout(
      () => {
        setLingering((map) => new Map([...map].filter(([, l]) => l.until > Date.now())));
      },
      Math.max(0, next - Date.now()),
    );
    return () => {
      window.clearTimeout(timer);
    };
  }, [lingering]);

  // New tickets: chime (after Start shift, unless muted), highlight once, announce politely.
  const seen = useRef<Set<string> | null>(null);
  const [highlighted, setHighlighted] = useState<ReadonlySet<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    const tickets = queue.data?.tickets;
    if (!tickets) return;
    if (seen.current) {
      const fresh = newTickets(seen.current, tickets);
      if (fresh.length > 0) {
        const { muted } = useKitchenStore.getState();
        if (!muted) playChime();
        setHighlighted(new Set(fresh));
        const first = tickets.find((ticket) => ticket.batch_id === fresh[0]);
        if (first) setAnnouncement(t('kitchen:newTicket', { ticket: ticketName(first) }));
      }
    }
    seen.current = new Set([...(seen.current ?? []), ...tickets.map((ticket) => ticket.batch_id)]);
    // ticketName and t only format the announcement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue.data]);
  useEffect(() => {
    if (highlighted.size === 0) return;
    const timer = window.setTimeout(() => {
      setHighlighted(new Set());
    }, HIGHLIGHT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [highlighted]);

  // Keep the screen awake for the whole shift (R10), also after a reload.
  useShiftLifecycle('kitchen');

  const board = useMemo(() => {
    const live = queue.data?.tickets ?? [];
    const ids = new Set(live.map((ticket) => ticket.batch_id));
    const kept = [...lingering.values()]
      .map((l) => l.ticket)
      .filter((ticket) => !ids.has(ticket.batch_id));
    return sortTickets([...live, ...kept]);
  }, [queue.data, lingering]);
  const serverNow = now + (queue.data?.clockOffset ?? 0);
  const openCount = board.filter((ticket) => !lingering.has(ticket.batch_id)).length;
  const strip = recentlyReady.filter((r) => !lingering.has(r.ticket.batch_id));
  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' });
  const warnMin = settings?.kitchenWarnMin ?? 0;
  const lateMin = settings?.kitchenLateMin ?? 0;

  let content;
  if (queue.isPending || !settings) {
    content = (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  } else if (queue.isError && !queue.data) {
    // A failed reload keeps the board it has (the connection state says the rest).
    content = (
      <ErrorState
        title={t('kitchen:loadFailed')}
        description={t('kitchen:loadFailedBody')}
        retryLabel={t('kitchen:retry')}
        retrying={queue.isFetching}
        onRetry={() => void queue.refetch()}
      />
    );
  } else if (board.length === 0) {
    content = (
      <EmptyState
        icon={ChefHat}
        title={t('kitchen:queueEmpty')}
        description={t('kitchen:queueEmptyBody')}
        className="py-24"
      />
    );
  } else {
    content = (
      <ul
        aria-label={t('kitchen:queue')}
        className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4"
      >
        {board.map((ticket) => (
          <li key={ticket.batch_id} className="grid">
            <TicketCard
              ticket={ticket}
              age={ticketAge(ticket.sent_at, serverNow, warnMin, lateMin)}
              highlight={highlighted.has(ticket.batch_id)}
              done={lingering.has(ticket.batch_id)}
              onReady={onReady}
            />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-fg">
      <header className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-2 border-b border-border bg-surface px-3 py-2 sm:gap-4 sm:px-4">
        <h1 className="flex shrink-0 items-center gap-2 text-xl font-semibold">
          <ChefHat aria-hidden className="size-icon text-brand" />
          {/* Phones (rare in a kitchen): icon only, so the clock and actions fit. */}
          <span className="max-sm:sr-only">{t('kitchen:title')}</span>
        </h1>
        {settings && (
          <span className="hidden truncate text-fg-muted xl:inline">{settings.restaurantName}</span>
        )}
        <div className="ms-auto flex flex-wrap items-center gap-2 sm:gap-3">
          <Clock className="text-2xl font-semibold whitespace-nowrap tabular-nums" />
          <ConnectionDot state={state} className="hidden sm:inline-flex" />
          <ConnectionDot state={state} showLabel={false} className="sm:hidden" />
          <Badge variant="neutral" className="h-9 px-3 text-base" aria-live="polite">
            {t('kitchen:openTickets', { count: openCount })}
          </Badge>
          <KitchenShift />
          <Button
            variant="outline"
            disabled={!canSend}
            onClick={() => {
              setSoldOutOpen(true);
            }}
            aria-label={t('kitchen:soldOut')}
            className="max-sm:size-control-md max-sm:px-0"
          >
            <ListX aria-hidden />
            <span className="max-sm:sr-only">{t('kitchen:soldOut')}</span>
          </Button>
          {/* The kitchen is always dark: no theme choice here. */}
          <AccountMenu showTheme={false} />
        </div>
      </header>
      <OfflineBanner online={state !== 'offline'} />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <main className="flex-1 p-4">{content}</main>
      {strip.length > 0 && (
        <section
          aria-labelledby="recently-ready"
          className="sticky bottom-0 z-20 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur"
        >
          <h2 id="recently-ready" className="mb-2 text-sm font-semibold text-fg-muted uppercase">
            {t('kitchen:recentlyReady')}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {strip.map(({ ticket, readyAt }) => (
              <li
                key={ticket.batch_id}
                className="flex items-center gap-2 rounded-full bg-success-bg px-3 py-1.5 font-semibold text-success"
              >
                <CheckCheck aria-hidden className="size-5" />
                {ticketName(ticket)}
                {ticket.is_addon && <span className="text-sm">· {t('kitchen:addOn')}</span>}
                <span className="text-sm font-normal">
                  {t('kitchen:recentlyReadyAt', { time: time.format(readyAt) })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <SoldOutSheet open={soldOutOpen} onOpenChange={setSoldOutOpen} />
    </div>
  );
}

export { KitchenApp as Component };
