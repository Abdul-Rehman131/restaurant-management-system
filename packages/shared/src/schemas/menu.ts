import * as z from 'zod/mini';

import { id, replayed } from './common';

/** set_item_availability: the Sold Out toggle (BR-13). */
export const setItemAvailabilityResponse = z.object({
  menu_item_id: id,
  is_available: z.boolean(),
  replayed,
});
export type SetItemAvailabilityResponse = z.infer<typeof setItemAvailabilityResponse>;
