import { amountToInput, parseAmount } from '@rms/shared';
import * as z from 'zod/mini';

/**
 * Admin form rules, pure so they are unit-tested (forms.test.ts). The fields are text as typed;
 * the schemas check them, and the to*() functions turn them into the RPC payloads: money in
 * integer minor units through parseAmount (never a float, CLAUDE.md rule 5), rates in basis
 * points. Messages are `admin:` i18n keys. The server checks every value again.
 */

// ===== Rates: "16" or "16.5" percent <-> basis points (1600, 1650) =====

/** "16.5" -> 1650. At most 2 decimals, 0 to 100 %. Null when it is not a rate. */
export function percentToBps(text: string): number | null {
  const bps = parseAmount(text, 2);
  return bps === null || bps > 10_000 ? null : bps;
}

/** 1650 -> "16.5", 1600 -> "16" (what the field shows). */
export function bpsToPercent(bps: number): string {
  return amountToInput(bps, 2).replace(/\.?0+$/, '');
}

/** A whole number from text ("12"), or null. */
export function parseWhole(text: string): number | null {
  const trimmed = text.trim();
  return /^\d{1,9}$/.test(trimmed) ? Number(trimmed) : null;
}

const required = (key: string) => z.string().check(z.refine((v) => v.trim() !== '', key));
const maxText = (max: number, key: string) =>
  z.string().check(z.refine((v) => v.trim().length <= max, key));

// ===== Menu item =====

export interface ItemForm {
  category_id: string;
  name: string;
  description: string;
  price: string;
  cost_price: string;
  prep_time_min: string;
  needs_kitchen: boolean;
  is_available: boolean;
}

export function itemFormSchema(minorUnits: number) {
  const money = (key: string, optional: boolean) =>
    z
      .string()
      .check(
        z.refine((v) => (optional && v.trim() === '') || parseAmount(v, minorUnits) !== null, key),
      );
  return z.object({
    category_id: z.string().check(z.refine((v) => v !== '', 'admin:form.categoryRequired')),
    name: required('admin:form.nameRequired').check(
      z.refine((v) => v.trim().length <= 80, 'admin:form.nameTooLong'),
    ),
    description: maxText(500, 'admin:form.descriptionTooLong'),
    price: money('admin:form.priceInvalid', false),
    cost_price: money('admin:form.priceInvalid', true),
    prep_time_min: z.string().check(
      z.refine((v) => {
        if (v.trim() === '') return true;
        const minutes = parseWhole(v);
        return minutes !== null && minutes <= 240;
      }, 'admin:form.prepTimeInvalid'),
    ),
    needs_kitchen: z.boolean(),
    is_available: z.boolean(),
  });
}

/** The save_menu_item payload (without the photo path, which the form adds). */
export function toItemInput(form: ItemForm, minorUnits: number) {
  const prep = form.prep_time_min.trim() === '' ? null : parseWhole(form.prep_time_min);
  return {
    category_id: form.category_id,
    name: form.name.trim(),
    description: form.description.trim() === '' ? null : form.description.trim(),
    price: parseAmount(form.price, minorUnits) ?? 0,
    cost_price: form.cost_price.trim() === '' ? 0 : (parseAmount(form.cost_price, minorUnits) ?? 0),
    prep_time_min: prep,
    needs_kitchen: form.needs_kitchen,
    is_available: form.is_available,
  };
}

// ===== Table =====

export const tableFormSchema = z.object({
  number: z.string().check(
    z.refine((v) => {
      const n = parseWhole(v);
      return n !== null && n >= 1 && n <= 999;
    }, 'admin:form.tableNumberInvalid'),
  ),
  capacity: z.string().check(
    z.refine((v) => {
      const n = parseWhole(v);
      return n !== null && n >= 1 && n <= 50;
    }, 'admin:form.capacityInvalid'),
  ),
  section: required('admin:form.sectionRequired').check(
    z.refine((v) => v.trim().length <= 40, 'admin:form.sectionTooLong'),
  ),
});
export type TableForm = z.infer<typeof tableFormSchema>;

// ===== Staff =====

/** Mirrors public.staff_login_email: 3 to 32 of a-z, 0-9, dot, dash, underscore. */
export const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export const staffFormSchema = z.object({
  username: z
    .string()
    .check(
      z.refine((v) => usernamePattern.test(v.trim().toLowerCase()), 'admin:form.usernameInvalid'),
    ),
  full_name: required('admin:form.fullNameRequired').check(
    z.refine((v) => v.trim().length <= 100, 'admin:form.fullNameTooLong'),
  ),
  phone: maxText(30, 'admin:form.phoneTooLong'),
  role: z.enum(['admin', 'cashier', 'waiter', 'chef', 'rider'], {
    error: 'admin:form.roleRequired',
  }),
});
export type StaffForm = z.infer<typeof staffFormSchema>;

// ===== Settings =====

export interface SettingsForm {
  restaurant_name: string;
  address: string;
  phone: string;
  receipt_footer: string;
  tax_registration_number: string;
  currency_code: string;
  currency_minor_units: string;
  timezone: string;
  day_cutoff_time: string;
  tax_percent: string;
  service_charge_percent: string;
  prices_include_tax: boolean;
  discount_reduces_charges: boolean;
  service_charge_on_dine_in: boolean;
  service_charge_on_take_away: boolean;
  service_charge_on_delivery: boolean;
  tax_on_service_charge: boolean;
  rounding_mode: 'half_up' | 'half_even' | 'up' | 'down';
  rounding_unit: string;
  kitchen_warn_min: string;
  kitchen_late_min: string;
}

const rate = z.string().check(z.refine((v) => percentToBps(v) !== null, 'admin:form.rateInvalid'));

export function settingsFormSchema(minorUnits: number) {
  return z
    .object({
      restaurant_name: required('admin:form.restaurantNameRequired').check(
        z.refine((v) => v.trim().length <= 120, 'admin:form.nameTooLong'),
      ),
      address: maxText(300, 'admin:form.tooLong'),
      phone: maxText(30, 'admin:form.phoneTooLong'),
      receipt_footer: maxText(500, 'admin:form.tooLong'),
      tax_registration_number: maxText(40, 'admin:form.tooLong'),
      currency_code: z
        .string()
        .check(
          z.refine((v) => /^[A-Z]{3}$/.test(v.trim().toUpperCase()), 'admin:form.currencyInvalid'),
        ),
      currency_minor_units: z
        .string()
        .check(z.refine((v) => /^[0-3]$/.test(v.trim()), 'admin:form.currencyInvalid')),
      timezone: required('admin:form.timezoneRequired'),
      day_cutoff_time: z
        .string()
        .check(z.refine((v) => /^(0\d|1[01]):[0-5]\d$/.test(v.trim()), 'admin:form.cutoffInvalid')),
      tax_percent: rate,
      service_charge_percent: rate,
      prices_include_tax: z.boolean(),
      discount_reduces_charges: z.boolean(),
      service_charge_on_dine_in: z.boolean(),
      service_charge_on_take_away: z.boolean(),
      service_charge_on_delivery: z.boolean(),
      tax_on_service_charge: z.boolean(),
      rounding_mode: z.enum(['half_up', 'half_even', 'up', 'down']),
      rounding_unit: z.string().check(
        z.refine((v) => {
          const unit = parseAmount(v, minorUnits);
          return unit !== null && unit >= 1 && unit <= 100_000;
        }, 'admin:form.roundingInvalid'),
      ),
      kitchen_warn_min: z.string().check(
        z.refine((v) => {
          const n = parseWhole(v);
          return n !== null && n >= 1 && n <= 240;
        }, 'admin:form.kitchenWarnInvalid'),
      ),
      kitchen_late_min: z.string().check(
        z.refine((v) => {
          const n = parseWhole(v);
          return n !== null && n >= 2 && n <= 480;
        }, 'admin:form.kitchenLateInvalid'),
      ),
    })
    .check(
      z.refine(
        (form) => {
          const warn = parseWhole(form.kitchen_warn_min);
          const late = parseWhole(form.kitchen_late_min);
          return warn === null || late === null || late > warn;
        },
        { message: 'admin:form.kitchenLateAfterWarn', path: ['kitchen_late_min'] },
      ),
    );
}

/** The update_settings payload: every field, converted (rates to bps, money to minor units). */
export function toSettingsChanges(form: SettingsForm, minorUnits: number) {
  const nullable = (v: string) => (v.trim() === '' ? null : v.trim());
  return {
    restaurant_name: form.restaurant_name.trim(),
    address: nullable(form.address),
    phone: nullable(form.phone),
    receipt_footer: nullable(form.receipt_footer),
    tax_registration_number: nullable(form.tax_registration_number),
    currency_code: form.currency_code.trim().toUpperCase(),
    currency_minor_units: Number(form.currency_minor_units),
    timezone: form.timezone,
    day_cutoff_time: form.day_cutoff_time.trim(),
    tax_bps: percentToBps(form.tax_percent) ?? 0,
    service_charge_bps: percentToBps(form.service_charge_percent) ?? 0,
    prices_include_tax: form.prices_include_tax,
    discount_reduces_charges: form.discount_reduces_charges,
    service_charge_on_dine_in: form.service_charge_on_dine_in,
    service_charge_on_take_away: form.service_charge_on_take_away,
    service_charge_on_delivery: form.service_charge_on_delivery,
    tax_on_service_charge: form.tax_on_service_charge,
    rounding_mode: form.rounding_mode,
    rounding_unit_minor: parseAmount(form.rounding_unit, minorUnits) ?? 1,
    kitchen_warn_min: parseWhole(form.kitchen_warn_min) ?? 10,
    kitchen_late_min: parseWhole(form.kitchen_late_min) ?? 20,
  };
}

/**
 * Only the keys whose values differ from the saved settings, so a save sends (and audits)
 * what changed; the currency, locked once orders exist, is sent only when it changed.
 */
export function changedSettings<T extends Record<string, unknown>>(
  next: T,
  saved: Partial<Record<keyof T, unknown>>,
): Partial<T> {
  const changes: Partial<T> = {};
  for (const key of Object.keys(next) as (keyof T)[]) {
    const before = saved[key];
    const after = next[key];
    // The database returns the cut-off as HH:MM:SS; the form edits HH:MM.
    const same =
      key === 'day_cutoff_time' && typeof before === 'string' && typeof after === 'string'
        ? before.slice(0, 5) === after.slice(0, 5)
        : (before ?? null) === (after ?? null);
    if (!same) changes[key] = after;
  }
  return changes;
}

// ===== Bill check =====

/** Line amounts as typed, one per line ("1,200", "450.50"); empty lines are ignored. */
export function parseLines(text: string, minorUnits: number): number[] | null {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  if (lines.length === 0) return null;
  const amounts = lines.map((line) => parseAmount(line, minorUnits));
  return amounts.every((a): a is number => a !== null && a > 0) ? amounts : null;
}

// ===== Sort order =====

/** Moves one id up (-1) or down (+1) in a list, for the reorder RPCs. */
export function moved(ids: string[], id: string, by: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + by;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to] ?? id, next[from] ?? id];
  return next;
}
