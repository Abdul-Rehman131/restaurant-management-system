import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';

import {
  adminMenuItem,
  billCheckResponse,
  staffAdminResponse,
  updateSettingsResponse,
} from './admin';

const item = {
  id: '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f',
  category_id: '1f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f',
  name: 'Lentil Soup',
  description: null,
  price: 45000,
  cost_price: 11250,
  prep_time_min: 12,
  needs_kitchen: true,
  is_available: true,
  image_path: 'items/2f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f.webp',
  sort_order: 10,
  is_active: true,
  updated_at: '2026-10-26T10:00:00+00:00',
};

describe('admin response schemas', () => {
  it('accepts an admin menu item with its cost price', () => {
    expect(z.parse(adminMenuItem, item).cost_price).toBe(11250);
  });

  it('rejects money that is not whole minor units', () => {
    expect(() => z.parse(adminMenuItem, { ...item, price: 450.5 })).toThrow();
    expect(() => z.parse(adminMenuItem, { ...item, cost_price: -1 })).toThrow();
  });

  it('accepts the Bill check totals', () => {
    const totals = {
      type: 'dine_in',
      line_count: 2,
      subtotal: 165000,
      discount: 5000,
      service_charge: 8000,
      tax: 25600,
      total: 193600,
    };
    expect(z.parse(billCheckResponse, totals).total).toBe(193600);
    expect(() => z.parse(billCheckResponse, { ...totals, type: 'catering' })).toThrow();
  });

  it('update_settings answers with the settings plus replayed', () => {
    const settings = {
      restaurant_name: 'Grill',
      currency_code: 'PKR',
      currency_minor_units: 2,
      timezone: 'Asia/Karachi',
      day_cutoff_time: '04:00:00',
      kitchen_warn_min: 10,
      kitchen_late_min: 20,
      tax_registration_number: null,
    };
    expect(z.parse(updateSettingsResponse, { ...settings, replayed: false }).replayed).toBe(false);
    expect(() => z.parse(updateSettingsResponse, settings)).toThrow();
  });

  it('a temporary password is long enough to be shown once', () => {
    const staff = {
      id: item.id,
      username: 'sara',
      full_name: 'Sara Khan',
      phone: null,
      role: 'waiter',
      is_active: true,
      created_at: '2026-10-26T10:00:00+00:00',
    };
    // Made at test time in the Edge Function's shape (3 groups of 4), never a literal: a
    // committed password-like string is a secret-scanner finding (gitleaks, S5).
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const group = () =>
      Array.from(
        crypto.getRandomValues(new Uint8Array(4)),
        (b) => alphabet[b % alphabet.length],
      ).join('');
    const password = [group(), group(), group()].join('-');
    expect(
      z.parse(staffAdminResponse, { staff, temporary_password: password, replayed: false })
        .temporary_password,
    ).toBe(password);
    expect(() =>
      z.parse(staffAdminResponse, { staff, temporary_password: 'short', replayed: false }),
    ).toThrow();
    expect(() =>
      z.parse(staffAdminResponse, { staff: { ...staff, role: 'owner' }, replayed: false }),
    ).toThrow();
  });
});
