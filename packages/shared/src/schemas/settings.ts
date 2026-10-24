import { z } from 'zod';

import type { PublicSettings } from '../settings';

/**
 * Response of the get_settings RPC (role-scoped, see migration role_scoped_rpcs). The RPC
 * returns jsonb, so the generated types only say `Json`: this schema is the contract.
 * Groups beyond "display" and "operations" depend on the caller's role, so they are optional.
 */
const minorInt = z.number().int();
const bps = z.number().int().min(0).max(10_000);

export const getSettingsResponse = z.object({
  // display: every staff role
  restaurant_name: z.string().min(1),
  currency_code: z.string().regex(/^[A-Z]{3}$/),
  currency_minor_units: z.number().int().min(0).max(3),
  timezone: z.string().min(1),
  // operations: every staff role
  day_cutoff_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  kitchen_warn_min: z.number().int().positive(),
  kitchen_late_min: z.number().int().positive(),
  // contact: admin, cashier, waiter
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  receipt_footer: z.string().nullable().optional(),
  // pricing: admin, cashier
  tax_bps: bps.optional(),
  service_charge_bps: bps.optional(),
  prices_include_tax: z.boolean().optional(),
  discount_reduces_charges: z.boolean().optional(),
  service_charge_on_dine_in: z.boolean().optional(),
  service_charge_on_take_away: z.boolean().optional(),
  service_charge_on_delivery: z.boolean().optional(),
  tax_on_service_charge: z.boolean().optional(),
  rounding_mode: z.enum(['half_up', 'half_even', 'up', 'down']).optional(),
  rounding_unit_minor: minorInt.positive().optional(),
});

export type GetSettingsResponse = z.infer<typeof getSettingsResponse>;

/** Validates the RPC result and maps it to the camelCase shape the UI uses. Throws on mismatch. */
export function parseSettings(data: unknown): PublicSettings {
  const s = getSettingsResponse.parse(data);
  const settings: PublicSettings = {
    restaurantName: s.restaurant_name,
    currencyCode: s.currency_code,
    currencyMinorUnits: s.currency_minor_units,
    timezone: s.timezone,
    dayCutoffTime: s.day_cutoff_time,
    kitchenWarnMin: s.kitchen_warn_min,
    kitchenLateMin: s.kitchen_late_min,
    receiptFooter: s.receipt_footer ?? null,
  };
  if (s.address !== undefined) settings.address = s.address;
  if (s.phone !== undefined) settings.phone = s.phone;
  if (s.tax_bps !== undefined) settings.taxBps = s.tax_bps;
  if (s.service_charge_bps !== undefined) settings.serviceChargeBps = s.service_charge_bps;
  return settings;
}
