import { Button, cn } from '@rms/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlarmClock,
  CheckCheck,
  ChefHat,
  CircleAlert,
  Flame,
  Hourglass,
  Play,
  Plus,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { useRpcAction } from '../../lib/useRpcAction';
import { useConnection } from '../../shell/connection-context';
import { kitchenKeys, kitchenRpc } from './data';
import { useTicketName } from './format';
import { ticketLabel, type AgeBand, type Ticket, type TicketAge } from './queue';

const bandLook: Record<AgeBand, { bar: string; text: string; icon: LucideIcon }> = {
  fresh: { bar: 'bg-success', text: 'text-success', icon: Timer },
  aging: { bar: 'bg-warning', text: 'text-warning', icon: Hourglass },
  late: { bar: 'bg-danger', text: 'text-danger', icon: AlarmClock },
};

/**
 * One kitchen ticket per batch (plan 4.11): who it is for, the ADD-ON ribbon, the age as
 * colour plus icon plus minutes plus a word (plan 4.1), the lines with quantity and notes,
 * and one large button: Start, then Ready. No prices anywhere (G6).
 */
export function TicketCard({
  ticket,
  age,
  highlight,
  done,
  onReady,
}: {
  ticket: Ticket;
  age: TicketAge;
  /** A new ticket: one short slide-in and a ring (no looping animation). */
  highlight: boolean;
  /** Marked Ready on this screen: it stays a few seconds, then moves to the strip. */
  done: boolean;
  onReady: (ticket: Ticket) => void;
}) {
  const { t } = useTranslation(['kitchen', 'rpc']);
  const { canSend } = useConnection();
  const queryClient = useQueryClient();
  const name = useTicketName()(ticket);
  const label = ticketLabel(ticket);
  const look = bandLook[age.band];
  const AgeIcon = age.band === 'late' ? Flame : look.icon;

  const action = useRpcAction(
    kitchenRpc.setBatch,
    useCallback(
      async (result: Awaited<ReturnType<typeof kitchenRpc.setBatch>>) => {
        if (result.batch_status === 'ready') onReady(ticket);
        // Shown only as the server has it (hard rule 9).
        await queryClient.refetchQueries({ queryKey: kitchenKeys.queue });
      },
      [onReady, ticket, queryClient],
    ),
  );
  const next = ticket.status === 'sent' ? 'preparing' : 'ready';
  const headingId = `ticket-${ticket.batch_id}`;

  return (
    <article
      aria-labelledby={headingId}
      data-band={age.band}
      data-status={done ? 'ready' : ticket.status}
      className={cn(
        'relative flex flex-col gap-3 overflow-hidden rounded-lg border border-border bg-surface py-4 ps-6 pe-4 shadow-sm',
        highlight && 'ring-4 ring-brand [--enter-y:-1rem] motion-safe:animate-enter',
        done && 'opacity-70',
      )}
    >
      {/* The age bar on the start edge; late pulses slowly, or is thicker without motion. */}
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-0 start-0 w-2',
          look.bar,
          age.band === 'late' &&
            'motion-safe:animate-pulse motion-safe:[animation-duration:2.5s] motion-reduce:w-4',
        )}
      />

      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold tracking-wide text-fg-muted uppercase">
            {label.kind === 'table' ? t('kitchen:dineIn') : t('kitchen:takeAway')}
          </span>
          <span className="truncate text-4xl leading-tight font-bold">
            {label.kind === 'table' ? t('kitchen:tableShort', { number: label.table }) : name}
          </span>
          {label.kind === 'table' && <span className="sr-only">{name}</span>}
        </h2>
        <p
          className={cn('flex items-center gap-1.5 text-xl font-semibold tabular-nums', look.text)}
        >
          <AgeIcon aria-hidden className="size-6 shrink-0" />
          {t('kitchen:age', { minutes: age.minutes })}{' '}
          <span className="text-base">· {t(`kitchen:band.${age.band}`)}</span>
        </p>
      </header>

      {ticket.is_addon && (
        <p className="-ms-2 flex items-center gap-2 self-start rounded-md bg-accent px-3 py-1 font-bold text-accent-fg">
          <Plus aria-hidden className="size-5" />
          {t('kitchen:addOnOf', { number: ticket.order_number })}
        </p>
      )}
      {!ticket.is_addon && <p className="text-sm text-fg-muted">{ticket.order_number}</p>}

      {ticket.status === 'preparing' && !done && (
        <p className="flex items-center gap-1.5 self-start rounded-full bg-info-bg px-3 py-1 text-sm font-semibold text-info">
          <ChefHat aria-hidden className="size-4" />
          {t('kitchen:status.preparing')}
        </p>
      )}

      <ul className="flex-1 space-y-2">
        {ticket.items.map((item) => (
          <li key={item.order_item_id} className="text-2xl leading-snug">
            <span className="me-2 font-bold tabular-nums">{item.quantity}×</span>
            {item.name}
            {item.notes && (
              <span className="mt-1 block rounded-md bg-warning-bg px-2 py-1 text-xl font-semibold text-warning">
                “{item.notes}”
              </span>
            )}
          </li>
        ))}
      </ul>

      {action.error && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-danger-bg p-3 text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t(action.error)}
        </p>
      )}

      {done ? (
        <p className="flex min-h-14 items-center justify-center gap-2 rounded-md bg-success-bg text-xl font-bold text-success">
          <CheckCheck aria-hidden className="size-6" />
          {t('kitchen:doneReady')}
        </p>
      ) : (
        <Button
          size="xl"
          className="min-h-14 w-full"
          variant={next === 'preparing' ? 'secondary' : 'primary'}
          loading={action.pending}
          disabled={!canSend}
          aria-label={
            next === 'preparing'
              ? t('kitchen:startFor', { ticket: name })
              : t('kitchen:readyFor', { ticket: name })
          }
          onClick={() => void action.run(ticket.batch_id, next)}
        >
          {next === 'preparing' ? <Play aria-hidden /> : <CheckCheck aria-hidden />}
          {next === 'preparing' ? t('kitchen:start') : t('kitchen:ready')}
        </Button>
      )}
    </article>
  );
}
