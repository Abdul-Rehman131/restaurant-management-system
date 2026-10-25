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
  timestamp,
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

/** set_order_status: Served, Completed (handover) or Cancelled. */
export const setOrderStatusResponse = orderSummary;
export type SetOrderStatusResponse = OrderSummary;

/** cancel_order: Cashier or Admin, with a reason (BR-09). */
export const cancelOrderResponse = orderSummary;
export type CancelOrderResponse = OrderSummary;

/** request_bill: the summary with bill_requested = true. */
export const requestBillResponse = orderSummary;
export type RequestBillResponse = OrderSummary;

/** apply_discount: Admin only (BR-10); the recalculated summary. */
export const applyDiscountResponse = orderSummary;
export type ApplyDiscountResponse = OrderSummary;

/** move_order_table: the summary with the new table and/or waiter. */
export const moveOrderTableResponse = orderSummary;
export type MoveOrderTableResponse = OrderSummary;

/** add_items_to_order: the order summary plus the new batch (2 or more: an ADD-ON, BR-06). */
export const addItemsToOrderResponse = z.extend(orderSummary, {
  batch_no: z.int().check(z.minimum(2)),
});
export type AddItemsToOrderResponse = z.infer<typeof addItemsToOrderResponse>;

/** remove_or_cancel_item: the recalculated order summary plus the cancelled line. */
export const removeOrCancelItemResponse = z.extend(orderSummary, { order_item_id: id });
export type RemoveOrCancelItemResponse = z.infer<typeof removeOrCancelItemResponse>;

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

/** void_payment: Admin only (G8); the payment summary plus the voided payment. */
export const voidPaymentResponse = z.extend(paymentSummary, { payment_id: id });
export type VoidPaymentResponse = z.infer<typeof voidPaymentResponse>;

/** One open order on the cashier's list, with server totals, paid and due. */
export const openBill = z.object({
  order_id: id,
  order_number: z.string(),
  type: orderType,
  status: orderStatus,
  payment_status: paymentStatus,
  table_id: z.nullable(id),
  table_number: z.nullable(z.int()),
  waiter_id: z.nullable(id),
  waiter_name: z.nullable(z.string()),
  customer_name: z.nullable(z.string()),
  customer_phone: z.nullable(z.string()),
  bill_requested: z.boolean(),
  bill_requested_at: z.nullable(timestamp),
  created_at: timestamp,
  subtotal: money,
  discount: money,
  service_charge: money,
  tax: money,
  total: money,
  paid: money,
  due: money,
});
export type OpenBill = z.infer<typeof openBill>;

/** get_open_bills: Bill Requested first, then by age. */
export const openBillsResponse = z.object({ bills: z.array(openBill) });
export type OpenBillsResponse = z.infer<typeof openBillsResponse>;
