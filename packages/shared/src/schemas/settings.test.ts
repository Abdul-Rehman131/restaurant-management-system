import { describe, expect, it } from 'vitest';

import { parseSettings } from './settings';

// Shapes as returned by get_settings for each role group (fake demo values).
const waiterPayload = {
  restaurant_name: 'Ember Kitchen (Demo)',
  currency_code: 'PKR',
  currency_minor_units: 2,
  timezone: 'Asia/Karachi',
  day_cutoff_time: '04:00:00',
  kitchen_warn_min: 10,
  kitchen_late_min: 20,
  address: 'Demo address',
  phone: '+00 000 000 0000',
  receipt_footer: null,
};
const adminPayload = {
  ...waiterPayload,
  tax_bps: 1600,
  service_charge_bps: 500,
  prices_include_tax: false,
  discount_reduces_charges: true,
  service_charge_on_dine_in: true,
  service_charge_on_take_away: false,
  service_charge_on_delivery: false,
  tax_on_service_charge: false,
  rounding_mode: 'half_up',
  rounding_unit_minor: 1,
};
const chefPayload = {
  restaurant_name: waiterPayload.restaurant_name,
  currency_code: waiterPayload.currency_code,
  currency_minor_units: waiterPayload.currency_minor_units,
  timezone: waiterPayload.timezone,
  day_cutoff_time: waiterPayload.day_cutoff_time,
  kitchen_warn_min: waiterPayload.kitchen_warn_min,
  kitchen_late_min: waiterPayload.kitchen_late_min,
};

describe('parseSettings (get_settings response)', () => {
  it('maps the waiter payload to camelCase without pricing', () => {
    const s = parseSettings(waiterPayload);
    expect(s.restaurantName).toBe('Ember Kitchen (Demo)');
    expect(s.currencyMinorUnits).toBe(2);
    expect(s.receiptFooter).toBeNull();
    expect(s.taxBps).toBeUndefined();
  });

  it('accepts the chef payload (display and operations only)', () => {
    expect(parseSettings(chefPayload).address).toBeUndefined();
  });

  it('keeps pricing for admin and cashier, in basis points', () => {
    const s = parseSettings(adminPayload);
    expect(s.taxBps).toBe(1600);
    expect(s.serviceChargeBps).toBe(500);
  });

  it('rejects a payload that breaks the contract', () => {
    expect(() => parseSettings({ ...waiterPayload, restaurant_name: '' })).toThrow();
    expect(() => parseSettings({ ...waiterPayload, currency_minor_units: 2.5 })).toThrow();
    expect(() => parseSettings({ ...adminPayload, tax_bps: 16.5 })).toThrow();
    expect(() => parseSettings({ ...waiterPayload, currency_code: 'rupees' })).toThrow();
    expect(() => parseSettings(null)).toThrow();
  });
});
