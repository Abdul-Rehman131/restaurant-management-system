import { rpc } from '@rms/shared';
import type { PostgrestError } from '@supabase/postgrest-js';
import { queryOptions } from '@tanstack/react-query';
import * as z from 'zod/mini';

import { db } from '../../lib/db';
import { RpcContractError } from '../../lib/rpc';

/**
 * The waiter's server data (TanStack Query). Reads are plain selects that RLS limits to what a
 * waiter may see (migration select_policies: active tables and menu, no cost price, own orders
 * only). Writes go only through the S1 RPCs, each with a request id (BR-15). Every answer is
 * parsed with its Zod schema before a screen sees it (ADR 002).
 */

export const waiterKeys = {
  all: ['waiter'] as const,
  tables: ['waiter', 'tables'] as const,
  myOrders: ['waiter', 'my-orders'] as const,
};

function parse<S extends z.ZodMiniType>(source: string, schema: S, data: unknown): z.infer<S> {
  const result = z.safeParse(schema, data);
  if (!result.success) throw new RpcContractError(source, result.error);
  return result.data;
}

// ===== Reads =====

const tableRow = z.object({
  id: rpc.id,
  number: z.int(),
  capacity: z.int(),
  section: z.string(),
  status: rpc.tableStatus,
});
export type TableRow = z.infer<typeof tableRow>;

export const tablesQuery = queryOptions({
  queryKey: waiterKeys.tables,
  queryFn: async () => {
    const { data, error } = await db
      .from('restaurant_tables')
      .select('id, number, capacity, section, status')
      .eq('is_active', true)
      .order('number');
    if (error) throw error;
    return parse('restaurant_tables', z.array(tableRow), data);
  },
});

const orderLine = z.object({
  id: rpc.id,
  name_snapshot: z.string(),
  quantity: z.int(),
  notes: z.nullable(z.string()),
  line_total: rpc.money,
  needs_kitchen: z.boolean(),
  is_cancelled: z.boolean(),
});
const batch = z.object({
  id: rpc.id,
  batch_no: z.int(),
  status: rpc.batchStatus,
  sent_at: z.nullable(rpc.timestamp),
  ready_at: z.nullable(rpc.timestamp),
  served_at: z.nullable(rpc.timestamp),
  order_items: z.array(orderLine),
});
const myOrder = z.object({
  id: rpc.id,
  order_number: z.string(),
  status: rpc.orderStatus,
  payment_status: rpc.paymentStatus,
  bill_requested: z.boolean(),
  table_id: z.nullable(rpc.id),
  created_at: rpc.timestamp,
  subtotal: rpc.money,
  discount: rpc.money,
  service_charge: rpc.money,
  tax: rpc.money,
  total: rpc.money,
  order_batches: z.array(batch),
});
export type OrderBatch = z.infer<typeof batch>;
export type OrderLine = z.infer<typeof orderLine>;
export type MyOrder = z.infer<typeof myOrder>;

/** Statuses of an open Dine-In order (Completed and Cancelled are closed). */
const openStatuses = ['accepted', 'preparing', 'ready', 'served'] as const;

/**
 * My open Dine-In orders with their batches and each batch's lines (order_items belong to a
 * batch: foreign key order_id, batch_no). RLS returns only the waiter's own orders.
 */
export const myOrdersQuery = queryOptions({
  queryKey: waiterKeys.myOrders,
  queryFn: async () => {
    const { data, error } = await db
      .from('orders')
      .select(
        `id, order_number, status, payment_status, bill_requested, table_id, created_at,
         subtotal, discount, service_charge, tax, total,
         order_batches (id, batch_no, status, sent_at, ready_at, served_at,
           order_items (id, name_snapshot, quantity, notes, line_total, needs_kitchen,
                        is_cancelled))`,
      )
      .eq('type', 'dine_in')
      .in('status', openStatuses)
      .order('created_at');
    if (error) throw error;
    const orders = parse('orders', z.array(myOrder), data);
    for (const order of orders) {
      order.order_batches.sort((a, b) => a.batch_no - b.batch_no);
    }
    return orders;
  },
});

// ===== Writes (S1 RPCs) =====

async function call<S extends z.ZodMiniType>(
  fn: string,
  schema: S,
  request: PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<z.infer<S>> {
  const { data, error } = await request;
  if (error) throw error;
  return parse(fn, schema, data);
}

export type RpcItems = { menu_item_id: string; quantity: number; notes?: string }[];

export const waiterRpc = {
  /** Send to Kitchen for a free table: one order, number and server totals (BR-01, BR-03). */
  createOrder: (requestId: string, tableId: string, items: RpcItems) =>
    call(
      'create_order',
      rpc.createOrderResponse,
      db.rpc('create_order', {
        p_request_id: requestId,
        p_type: 'dine_in',
        p_table_id: tableId,
        p_customer_name: '',
        p_customer_phone: '',
        p_items: items,
      }),
    ),
  /** Add More Items: a new batch, shown to the kitchen as ADD-ON (BR-06). */
  addItems: (requestId: string, orderId: string, items: RpcItems) =>
    call(
      'add_items_to_order',
      rpc.addItemsToOrderResponse,
      db.rpc('add_items_to_order', {
        p_request_id: requestId,
        p_order_id: orderId,
        p_items: items,
      }),
    ),
  markServed: (requestId: string, orderId: string) =>
    call(
      'set_order_status',
      rpc.setOrderStatusResponse,
      db.rpc('set_order_status', {
        p_request_id: requestId,
        p_order_id: orderId,
        p_status: 'served',
      }),
    ),
  requestBill: (requestId: string, orderId: string) =>
    call(
      'request_bill',
      rpc.requestBillResponse,
      db.rpc('request_bill', { p_request_id: requestId, p_order_id: orderId }),
    ),
  moveTable: (requestId: string, orderId: string, toTableId: string) =>
    call(
      'move_order_table',
      rpc.moveOrderTableResponse,
      db.rpc('move_order_table', {
        p_request_id: requestId,
        p_order_id: orderId,
        p_to_table_id: toTableId,
      }),
    ),
};
