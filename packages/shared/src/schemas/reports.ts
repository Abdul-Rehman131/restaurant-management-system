import * as z from 'zod/mini';

import { count, id, isoDate, money, orderType } from './common';

/** get_sales_summary: the basic daily report (M9). Money in minor units. */
export const salesSummaryResponse = z.object({
  business_date: isoDate,
  orders_count: count,
  gross_sales: money,
  net_sales: money,
  discount: money,
  service_charge: money,
  tax: money,
  average_order_value: money,
  cancelled_count: count,
  open_count: count,
  by_type: z.array(z.object({ type: orderType, orders: count, sales: money })),
  top_items: z.array(
    z.object({ menu_item_id: id, name: z.string(), quantity: count, sales: money }),
  ),
  /** 24 hours in business-day order, from the cut-off hour (S5). */
  by_hour: z.array(
    z.object({ hour: z.int().check(z.minimum(0), z.maximum(23)), orders: count, sales: money }),
  ),
});
export type SalesSummaryResponse = z.infer<typeof salesSummaryResponse>;
