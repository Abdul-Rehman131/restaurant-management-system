import * as z from 'zod/mini';

import type { PublicSettings } from '../settings';

/**
 * Response of the get_settings RPC (role-scoped, see migration role_scoped_rpcs). The RPC
 * returns jsonb, so the generated types only say `Json`: this schema is the contract.
 * Groups beyond "display" and "operations" depend on the caller's role, so they are optional.
 */
// zod/mini: the tree-shakable build, so the shell bundle stays within budget (plan 4.10).
const nonEmpty = z.string().check(z.minLength(1));
const positiveInt = z.int().check(z.positive());
const bps = z.int().check(z.minimum(0), z.maximum(10_000));

export const getSettingsResponse = z.object({
  // display: every staff role
  restaurant_name: nonEmpty,
  currency_code: z.string().check(z.regex(/^[A-Z]{3}$/)),
  currency_minor_units: z.int().check(z.minimum(0), z.maximum(3)),
  timezone: nonEmpty,
  // operations: every staff role
  day_cutoff_time: z.string().check(z.regex(/^\d{2}:\d{2}(:\d{2})?$/)),
  kitchen_warn_min: positiveInt,
  kitchen_late_min: positiveInt,
  // contact: admin, cashier, waiter
  address: z.optional(z.nullable(z.string())),
  phone: z.optional(z.nullable(z.string())),
  receipt_footer: z.optional(z.nullable(z.string())),
  tax_registration_number: z.optional(z.nullable(z.string())),
  // pricing: admin, cashier
  tax_bps: z.optional(bps),
  service_charge_bps: z.optional(bps),
  prices_include_tax: z.optional(z.boolean()),
  discount_reduces_charges: z.optional(z.boolean()),
  service_charge_on_dine_in: z.optional(z.boolean()),
  service_charge_on_take_away: z.optional(z.boolean()),
  service_charge_on_delivery: z.optional(z.boolean()),
  tax_on_service_charge: z.optional(z.boolean()),
  rounding_mode: z.optional(z.enum(['half_up', 'half_even', 'up', 'down'])),
  rounding_unit_minor: z.optional(positiveInt),
});

export type GetSettingsResponse = z.infer<typeof getSettingsResponse>;

/** Validates the RPC result and maps it to the camelCase shape the UI uses. Throws on mismatch. */
export function parseSettings(data: unknown): PublicSettings {
  const s = z.parse(getSettingsResponse, data);
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
  if (s.tax_registration_number !== undefined) {
    settings.taxRegistrationNumber = s.tax_registration_number;
  }
  if (s.tax_bps !== undefined) settings.taxBps = s.tax_bps;
  if (s.service_charge_bps !== undefined) settings.serviceChargeBps = s.service_charge_bps;
  return settings;
}
