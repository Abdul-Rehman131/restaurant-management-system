import { rpc } from '@rms/shared';
import type { PostgrestError } from '@supabase/postgrest-js';
import { queryOptions } from '@tanstack/react-query';
import * as z from 'zod/mini';

import { db } from '../../lib/db';
import { RpcContractError } from '../../lib/rpc';
import { sortTickets, type Ticket } from './queue';

/**
 * The kitchen's server data. The chef has no SELECT on orders, order lines or the menu
 * (migration select_policies): the screen reads only get_kitchen_queue and
 * get_menu_availability, which carry no money field (G6), and writes only through
 * set_batch_status and set_item_availability, each with a request id (BR-15). Every answer
 * is parsed with its Zod schema (ADR 002).
 */
export const kitchenKeys = {
  all: ['kitchen'] as const,
  queue: ['kitchen', 'queue'] as const,
  menu: ['kitchen', 'menu'] as const,
};

async function call<S extends z.ZodMiniType>(
  fn: string,
  schema: S,
  request: PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<z.infer<S>> {
  const { data, error } = await request;
  if (error) throw error;
  const result = z.safeParse(schema, data);
  if (!result.success) throw new RpcContractError(fn, result.error);
  return result.data;
}

export interface Queue {
  tickets: Ticket[];
  /** Server clock minus device clock when the queue was read (ages use the server's time). */
  clockOffset: number;
}

export const queueQuery = queryOptions({
  queryKey: kitchenKeys.queue,
  queryFn: async (): Promise<Queue> => {
    const queue = await call(
      'get_kitchen_queue',
      rpc.kitchenQueueResponse,
      db.rpc('get_kitchen_queue'),
    );
    return {
      tickets: sortTickets(queue.tickets),
      clockOffset: Date.parse(queue.server_time) - Date.now(),
    };
  },
});

export const menuQuery = queryOptions({
  queryKey: kitchenKeys.menu,
  queryFn: async () =>
    (
      await call(
        'get_menu_availability',
        rpc.menuAvailabilityResponse,
        db.rpc('get_menu_availability'),
      )
    ).items,
});
export type MenuAvailabilityItem = Awaited<
  ReturnType<NonNullable<typeof menuQuery.queryFn>>
>[number];

export const kitchenRpc = {
  /** Start (Preparing) or Ready: only Sent to Preparing to Ready (set_batch_status). */
  setBatch: (requestId: string, batchId: string, status: 'preparing' | 'ready') =>
    call(
      'set_batch_status',
      rpc.setBatchStatusResponse,
      db.rpc('set_batch_status', {
        p_request_id: requestId,
        p_batch_id: batchId,
        p_status: status,
      }),
    ),
  /** Sold Out or available again (BR-13): every ordering screen updates live. */
  setAvailability: (requestId: string, menuItemId: string, available: boolean) =>
    call(
      'set_item_availability',
      rpc.setItemAvailabilityResponse,
      db.rpc('set_item_availability', {
        p_request_id: requestId,
        p_menu_item_id: menuItemId,
        p_is_available: available,
      }),
    ),
};
