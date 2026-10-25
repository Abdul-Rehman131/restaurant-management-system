import * as z from 'zod/mini';

import {
  id,
  isoDate,
  money,
  orderStatus,
  orderType,
  paymentStatus,
  replayed,
  tableStatus,
} from './common';

/**
 * private.order_summary: returned by create_order, add_items_to_order, set_order_status,
 * request_bill, remove_or_cancel_item, cancel_order, apply_discount and move_order_table.
 */
export const orderSummary = z.object({
  order_id: id,
  order_number: z.string().check(z.regex(/^ORD-\d{8}-\d{3,}$/)),
  business_date: isoDate,
  type: orderType,
  status: orderStatus,
  payment_status: paymentStatus,
  table_id: z.nullable(id),
  waiter_id: z.nullable(id),
  bill_requested: z.boolean(),
  subtotal: money,
  discount: money,
  service_charge: money,
  tax: money,
  total: money,
  replayed,
});
export type OrderSummary = z.infer<typeof orderSummary>;

export const createOrderResponse = orderSummary;
export type CreateOrderResponse = OrderSummary;

/** add_items_to_order: the order summary plus the new batch (2 or more: an ADD-ON, BR-06). */
export const addItemsToOrderResponse = z.extend(orderSummary, {
  batch_no: z.int().check(z.minimum(2)),
});
export type AddItemsToOrderResponse = z.infer<typeof addItemsToOrderResponse>;

/** private.payment_summary: returned by record_payment and void_payment. */
export const paymentSummary = z.object({
  order_id: id,
  order_number: z.string(),
  status: orderStatus,
  payment_status: paymentStatus,
  total: money,
  paid: money,
  change_due: money,
  table_status: z.nullable(tableStatus),
  replayed,
});
export type PaymentSummary = z.infer<typeof paymentSummary>;

export const recordPaymentResponse = paymentSummary;
export type RecordPaymentResponse = PaymentSummary;
