import * as z from 'zod/mini';

import { id, replayed } from './common';

/** set_item_availability: the Sold Out toggle (BR-13). */
export const setItemAvailabilityResponse = z.object({
  menu_item_id: id,
  is_available: z.boolean(),
  replayed,
});
export type SetItemAvailabilityResponse = z.infer<typeof setItemAvailabilityResponse>;

/** get_menu_availability: the Sold Out list (BR-13), no prices. */
export const menuAvailabilityItem = z.object({
  menu_item_id: id,
  name: z.string(),
  category_id: id,
  category_name: z.string(),
  needs_kitchen: z.boolean(),
  is_available: z.boolean(),
});
export const menuAvailabilityResponse = z.object({ items: z.array(menuAvailabilityItem) });
export type MenuAvailabilityResponse = z.infer<typeof menuAvailabilityResponse>;
