import * as z from 'zod/mini';

import { batchStatus, id, orderStatus, replayed } from './common';

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
