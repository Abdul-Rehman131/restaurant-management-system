import { rpc } from '@rms/shared';
import type { PostgrestError } from '@supabase/postgrest-js';
import { queryOptions } from '@tanstack/react-query';
import * as z from 'zod/mini';

import { db } from '../../lib/db';
import { RpcContractError } from '../../lib/rpc';
import { sortBills } from './bills';
import type { Tender } from './pay';

/**
 * The cashier's server data (Admin uses the same screens). Reads: get_open_bills, and plain
 * selects that RLS allows for Cashier and Admin (orders with their batches, lines and
 * payments; no cost_snapshot column is granted, G6). Writes: only the S1 RPCs, each with a
 * request id (BR-15). Every answer is parsed with its Zod schema (ADR 002).
 */
export const cashierKeys = {
  all: ['cashier'] as const,
  bills: ['cashier', 'bills'] as const,
  bill: (orderId: string) => ['cashier', 'bill', orderId] as const,
  tables: ['cashier', 'tables'] as const,
  waiters: ['cashier', 'waiters'] as const,
};

function parse<S extends z.ZodMiniType>(source: string, schema: S, data: unknown): z.infer<S> {
  const result = z.safeParse(schema, data);
  if (!result.success) throw new RpcContractError(source, result.error);
  return result.data;
}

async function call<S extends z.ZodMiniType>(
  fn: string,
  schema: S,
  request: PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<z.infer<S>> {
  const { data, error } = await request;
  if (error) throw error;
  return parse(fn, schema, data);
}

// ===== Reads =====

export const billsQuery = queryOptions({
  queryKey: cashierKeys.bills,
  queryFn: async () =>
    sortBills(
      (await call('get_open_bills', rpc.openBillsResponse, db.rpc('get_open_bills'))).bills,
    ),
});

const line = z.object({
  id: rpc.id,
  name_snapshot: z.string(),
  price_snapshot: rpc.money,
  quantity: z.int(),
  notes: z.nullable(z.string()),
  line_total: rpc.money,
  needs_kitchen: z.boolean(),
  is_cancelled: z.boolean(),
  cancel_reason: z.nullable(z.string()),
});
const batch = z.object({
  id: rpc.id,
  batch_no: z.int(),
  status: rpc.batchStatus,
  sent_at: z.nullable(rpc.timestamp),
  order_items: z.array(line),
});
const payment = z.object({
  id: rpc.id,
  method: rpc.paymentMethod,
  amount: rpc.money,
  tendered: z.nullable(rpc.money),
  reference: z.nullable(z.string()),
  received_at: rpc.timestamp,
  voided_at: z.nullable(rpc.timestamp),
  void_reason: z.nullable(z.string()),
});
const billDetail = z.object({
  id: rpc.id,
  order_number: z.string(),
  type: rpc.orderType,
  status: rpc.orderStatus,
  payment_status: rpc.paymentStatus,
  bill_requested: z.boolean(),
  table_id: z.nullable(rpc.id),
  waiter_id: z.nullable(rpc.id),
  customer_name: z.nullable(z.string()),
  customer_phone: z.nullable(z.string()),
  created_at: rpc.timestamp,
  subtotal: rpc.money,
  discount: rpc.money,
  discount_reason: z.nullable(z.string()),
  service_charge: rpc.money,
  tax: rpc.money,
  total: rpc.money,
  table: z.nullable(z.object({ number: z.int() })),
  waiter: z.nullable(z.object({ full_name: z.string() })),
  order_batches: z.array(batch),
  payments: z.array(payment),
});
export type BillDetail = z.infer<typeof billDetail>;
export type BillLine = z.infer<typeof line>;
export type BillPayment = z.infer<typeof payment>;

export const billQuery = (orderId: string) =>
  queryOptions({
    queryKey: cashierKeys.bill(orderId),
    queryFn: async () => {
      const { data, error } = await db
        .from('orders')
        .select(
          `id, order_number, type, status, payment_status, bill_requested, table_id, waiter_id,
           customer_name, customer_phone, created_at, subtotal, discount, discount_reason,
           service_charge, tax, total,
           table:restaurant_tables!orders_table_id_fkey (number),
           waiter:profiles!orders_waiter_id_fkey (full_name),
           order_batches (id, batch_no, status, sent_at,
             order_items (id, name_snapshot, price_snapshot, quantity, notes, line_total,
                          needs_kitchen, is_cancelled, cancel_reason)),
           payments (id, method, amount, tendered, reference, received_at, voided_at, void_reason)`,
        )
        .eq('id', orderId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const bill = parse('orders', billDetail, data);
      bill.order_batches.sort((a, b) => a.batch_no - b.batch_no);
      bill.payments.sort((a, b) => a.received_at.localeCompare(b.received_at));
      return bill;
    },
  });

const tableRow = z.object({
  id: rpc.id,
  number: z.int(),
  section: z.string(),
  status: rpc.tableStatus,
});
export type CashierTable = z.infer<typeof tableRow>;

export const tablesQuery = queryOptions({
  queryKey: cashierKeys.tables,
  queryFn: async () => {
    const { data, error } = await db
      .from('restaurant_tables')
      .select('id, number, section, status')
      .eq('is_active', true)
      .order('number');
    if (error) throw error;
    return parse('restaurant_tables', z.array(tableRow), data);
  },
});

const waiterRow = z.object({ id: rpc.id, full_name: z.string() });
export type WaiterOption = z.infer<typeof waiterRow>;

/** Active waiters for the waiter picker (create_order p_waiter_id, move_order_table). */
export const waitersQuery = queryOptions({
  queryKey: cashierKeys.waiters,
  queryFn: async () => {
    const { data, error } = await db
      .from('profiles')
      .select('id, full_name')
      .eq('role', 'waiter')
      .eq('is_active', true)
      .order('full_name');
    if (error) throw error;
    return parse('profiles', z.array(waiterRow), data);
  },
  staleTime: 5 * 60_000,
});

// ===== Writes (S1 RPCs) =====

export type RpcItems = { menu_item_id: string; quantity: number; notes?: string }[];

export const cashierRpc = {
  recordPayment: (requestId: string, orderId: string, tenders: Tender[]) =>
    call(
      'record_payment',
      rpc.recordPaymentResponse,
      db.rpc('record_payment', {
        p_request_id: requestId,
        p_order_id: orderId,
        p_tenders: tenders,
      }),
    ),
  createOrder: (
    requestId: string,
    order:
      | { type: 'take_away'; customerName: string; customerPhone: string }
      | { type: 'dine_in'; tableId: string; waiterId: string | null },
    items: RpcItems,
  ) =>
    call(
      'create_order',
      rpc.createOrderResponse,
      db.rpc('create_order', {
        p_request_id: requestId,
        p_type: order.type,
        p_table_id: order.type === 'dine_in' ? order.tableId : (null as unknown as string),
        p_customer_name: order.type === 'take_away' ? order.customerName : '',
        p_customer_phone: order.type === 'take_away' ? order.customerPhone : '',
        p_items: items,
        ...(order.type === 'dine_in' && order.waiterId ? { p_waiter_id: order.waiterId } : {}),
      }),
    ),
  /** Served (Dine-In), or Completed: the Take Away handover (S1 rules, BR-12). */
  setStatus: (requestId: string, orderId: string, status: 'served' | 'completed') =>
    call(
      'set_order_status',
      rpc.setOrderStatusResponse,
      db.rpc('set_order_status', {
        p_request_id: requestId,
        p_order_id: orderId,
        p_status: status,
      }),
    ),
  requestBill: (requestId: string, orderId: string) =>
    call(
      'request_bill',
      rpc.requestBillResponse,
      db.rpc('request_bill', { p_request_id: requestId, p_order_id: orderId }),
    ),
  move: (requestId: string, orderId: string, tableId: string | null, waiterId: string | null) =>
    call(
      'move_order_table',
      rpc.moveOrderTableResponse,
      db.rpc('move_order_table', {
        p_request_id: requestId,
        p_order_id: orderId,
        ...(tableId ? { p_to_table_id: tableId } : {}),
        ...(waiterId ? { p_waiter_id: waiterId } : {}),
      }),
    ),
  cancelItem: (requestId: string, orderItemId: string, reason: string) =>
    call(
      'remove_or_cancel_item',
      rpc.removeOrCancelItemResponse,
      db.rpc('remove_or_cancel_item', {
        p_request_id: requestId,
        p_order_item_id: orderItemId,
        p_reason: reason,
      }),
    ),
  cancelOrder: (requestId: string, orderId: string, reason: string) =>
    call(
      'cancel_order',
      rpc.cancelOrderResponse,
      db.rpc('cancel_order', { p_request_id: requestId, p_order_id: orderId, p_reason: reason }),
    ),
  /** Admin only (BR-10): a fixed amount in minor units; 0 removes the discount. */
  applyDiscount: (requestId: string, orderId: string, amount: number, reason: string) =>
    call(
      'apply_discount',
      rpc.applyDiscountResponse,
      db.rpc('apply_discount', {
        p_request_id: requestId,
        p_order_id: orderId,
        p_amount: amount,
        p_reason: reason,
      }),
    ),
  /** Admin only (G8). */
  voidPayment: (requestId: string, paymentId: string, reason: string) =>
    call(
      'void_payment',
      rpc.voidPaymentResponse,
      db.rpc('void_payment', {
        p_request_id: requestId,
        p_payment_id: paymentId,
        p_reason: reason,
      }),
    ),
};
