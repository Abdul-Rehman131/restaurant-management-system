import * as z from 'zod/mini';

import { batchStatus, id, orderStatus, orderType, replayed, timestamp } from './common';

/** set_batch_status: the batch the kitchen changed and the order status derived from it. */
export const setBatchStatusResponse = z.object({
  batch_id: id,
  order_id: id,
  batch_no: z.int().check(z.minimum(1)),
  batch_status: batchStatus,
  order_status: orderStatus,
  replayed,
});
export type SetBatchStatusResponse = z.infer<typeof setBatchStatusResponse>;

/** One kitchen line: never a price or cost (G6). */
export const kitchenItem = z.object({
  order_item_id: id,
  name: z.string(),
  quantity: z.int().check(z.minimum(1), z.maximum(99)),
  notes: z.nullable(z.string()),
});

/** One ticket per open batch; batch 2 and later are ADD-ONs (BR-06). */
export const kitchenTicket = z.object({
  batch_id: id,
  order_id: id,
  order_number: z.string(),
  order_type: orderType,
  table_number: z.nullable(z.int()),
  /** Take Away: the name the kitchen calls out; null for Dine-In. */
  customer_name: z.nullable(z.string()),
  batch_no: z.int().check(z.minimum(1)),
  is_addon: z.boolean(),
  status: z.enum(['sent', 'preparing']),
  sent_at: timestamp,
  preparing_at: z.nullable(timestamp),
  items: z.array(kitchenItem).check(z.minLength(1)),
});
export type KitchenTicket = z.infer<typeof kitchenTicket>;

/** get_kitchen_queue: server_time for the ticket age (G11) and the tickets, oldest first. */
export const kitchenQueueResponse = z.object({
  server_time: timestamp,
  tickets: z.array(kitchenTicket),
});
export type KitchenQueueResponse = z.infer<typeof kitchenQueueResponse>;
