import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';

import {
  bpsToPercent,
  changedSettings,
  itemFormSchema,
  moved,
  parseLines,
  percentToBps,
  settingsFormSchema,
  staffFormSchema,
  tableFormSchema,
  toItemInput,
  toSettingsChanges,
  type ItemForm,
  type SettingsForm,
} from './forms';
import { checkSource, fitWithin, PHOTO_MAX_SIDE } from './photo';

const errorsOf = (schema: z.ZodMiniType, value: unknown) => {
  const result = z.safeParse(schema, value);
  return result.success ? [] : result.error.issues.map((i) => i.message);
};

describe('rates in basis points', () => {
  it('turns typed percent into basis points without floats', () => {
    expect(percentToBps('16')).toBe(1600);
    expect(percentToBps('16.5')).toBe(1650);
    expect(percentToBps('7.25')).toBe(725);
    expect(percentToBps('0')).toBe(0);
    expect(percentToBps('100')).toBe(10_000);
  });

  it('refuses what is not a rate', () => {
    expect(percentToBps('100.01')).toBeNull();
    expect(percentToBps('16.555')).toBeNull();
    expect(percentToBps('-1')).toBeNull();
    expect(percentToBps('16%')).toBeNull();
    expect(percentToBps('')).toBeNull();
  });

  it('shows basis points as short percent text', () => {
    expect(bpsToPercent(1600)).toBe('16');
    expect(bpsToPercent(1650)).toBe('16.5');
    expect(bpsToPercent(725)).toBe('7.25');
    expect(bpsToPercent(0)).toBe('0');
    expect(percentToBps(bpsToPercent(1234))).toBe(1234);
  });
});

describe('menu item form', () => {
  const valid: ItemForm = {
    category_id: '1f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f',
    name: ' Lentil Soup ',
    description: '',
    price: '1,200.50',
    cost_price: '',
    prep_time_min: '12',
    needs_kitchen: true,
    is_available: true,
  };

  it('accepts a valid item and makes integer minor units', () => {
    expect(errorsOf(itemFormSchema(2), valid)).toEqual([]);
    expect(toItemInput(valid, 2)).toEqual({
      category_id: valid.category_id,
      name: 'Lentil Soup',
      description: null,
      price: 120050,
      cost_price: 0,
      prep_time_min: 12,
      needs_kitchen: true,
      is_available: true,
    });
  });

  it('a currency without decimals refuses them', () => {
    expect(errorsOf(itemFormSchema(0), valid)).toEqual(['admin:form.priceInvalid']);
    expect(toItemInput({ ...valid, price: '1200' }, 0).price).toBe(1200);
  });

  it('names each wrong field', () => {
    expect(
      errorsOf(itemFormSchema(2), {
        ...valid,
        category_id: '',
        name: ' ',
        price: '12.345',
        cost_price: 'abc',
        prep_time_min: '241',
      }),
    ).toEqual([
      'admin:form.categoryRequired',
      'admin:form.nameRequired',
      'admin:form.priceInvalid',
      'admin:form.priceInvalid',
      'admin:form.prepTimeInvalid',
    ]);
    expect(errorsOf(itemFormSchema(2), { ...valid, name: 'x'.repeat(81) })).toEqual([
      'admin:form.nameTooLong',
    ]);
  });
});

describe('table and staff forms', () => {
  it('table numbers 1 to 999, seats 1 to 50, a section', () => {
    expect(errorsOf(tableFormSchema, { number: '12', capacity: '4', section: 'Hall' })).toEqual([]);
    expect(errorsOf(tableFormSchema, { number: '0', capacity: '51', section: ' ' })).toEqual([
      'admin:form.tableNumberInvalid',
      'admin:form.capacityInvalid',
      'admin:form.sectionRequired',
    ]);
    expect(errorsOf(tableFormSchema, { number: '1.5', capacity: '4', section: 'Hall' })).toEqual([
      'admin:form.tableNumberInvalid',
    ]);
  });

  it('usernames follow the login rule (3 to 32, a-z 0-9 . _ -)', () => {
    const staff = { username: 'Sara.K', full_name: 'Sara Khan', phone: '', role: 'waiter' };
    expect(errorsOf(staffFormSchema, staff)).toEqual([]);
    expect(errorsOf(staffFormSchema, { ...staff, username: 'sa' })).toEqual([
      'admin:form.usernameInvalid',
    ]);
    expect(errorsOf(staffFormSchema, { ...staff, username: 'sara khan' })).toEqual([
      'admin:form.usernameInvalid',
    ]);
    expect(errorsOf(staffFormSchema, { ...staff, role: 'owner' })).toEqual([
      'admin:form.roleRequired',
    ]);
  });
});

describe('settings form', () => {
  const form: SettingsForm = {
    restaurant_name: ' Grill ',
    address: '',
    phone: '',
    receipt_footer: 'Thank you',
    tax_registration_number: '',
    currency_code: 'pkr',
    currency_minor_units: '2',
    timezone: 'Asia/Karachi',
    day_cutoff_time: '04:00',
    tax_percent: '16',
    service_charge_percent: '5.5',
    prices_include_tax: false,
    discount_reduces_charges: true,
    service_charge_on_dine_in: true,
    service_charge_on_take_away: false,
    service_charge_on_delivery: false,
    tax_on_service_charge: false,
    rounding_mode: 'half_up',
    rounding_unit: '0.01',
    kitchen_warn_min: '10',
    kitchen_late_min: '20',
  };

  it('accepts valid settings and converts them', () => {
    expect(errorsOf(settingsFormSchema(2), form)).toEqual([]);
    expect(toSettingsChanges(form, 2)).toMatchObject({
      restaurant_name: 'Grill',
      address: null,
      currency_code: 'PKR',
      tax_bps: 1600,
      service_charge_bps: 550,
      rounding_unit_minor: 1,
      kitchen_warn_min: 10,
    });
  });

  it('checks ranges', () => {
    expect(
      errorsOf(settingsFormSchema(2), {
        ...form,
        tax_percent: '101',
        day_cutoff_time: '12:00',
        kitchen_warn_min: '20',
        kitchen_late_min: '15',
        rounding_unit: '0',
      }),
    ).toEqual([
      'admin:form.cutoffInvalid',
      'admin:form.rateInvalid',
      'admin:form.roundingInvalid',
      'admin:form.kitchenLateAfterWarn',
    ]);
  });

  it('sends only what changed (the cut-off compares HH:MM)', () => {
    const saved = { ...toSettingsChanges(form, 2), day_cutoff_time: '04:00:00' };
    expect(changedSettings(toSettingsChanges(form, 2), saved)).toEqual({});
    expect(changedSettings({ ...toSettingsChanges(form, 2), tax_bps: 1700 }, saved)).toEqual({
      tax_bps: 1700,
    });
  });
});

describe('Bill check lines', () => {
  it('one amount per line, blank lines ignored', () => {
    expect(parseLines('1,200\n\n450.50\n', 2)).toEqual([120000, 45050]);
    expect(parseLines('   ', 2)).toBeNull();
    expect(parseLines('100\nabc', 2)).toBeNull();
    expect(parseLines('0', 2)).toBeNull();
  });
});

describe('photos', () => {
  it('scales down to the longest side, never up', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: PHOTO_MAX_SIDE, height: 900 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 900, height: PHOTO_MAX_SIDE });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(5000, 1)).toEqual({ width: PHOTO_MAX_SIDE, height: 1 });
  });

  it('refuses what is not an image or too large', () => {
    expect(checkSource({ type: 'image/jpeg', size: 3_000_000 })).toBeNull();
    expect(checkSource({ type: 'application/pdf', size: 10 })).toBe('notImage');
    expect(checkSource({ type: 'image/png', size: 30_000_000 })).toBe('tooLarge');
  });
});

describe('reorder', () => {
  it('moves one id up or down, never past the ends', () => {
    expect(moved(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(moved(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(moved(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moved(['a', 'b', 'c'], 'c', 1)).toEqual(['a', 'b', 'c']);
    expect(moved(['a', 'b'], 'x', 1)).toEqual(['a', 'b']);
  });
});
