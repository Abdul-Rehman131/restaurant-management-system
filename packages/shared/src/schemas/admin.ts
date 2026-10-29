import * as z from 'zod/mini';

import { getSettingsResponse } from './settings';
import { count, id, money, orderType, replayed, tableStatus, timestamp } from './common';
import { Constants } from '../database.types';

/**
 * Admin RPCs (S5). Cost prices appear only here (admin_menu and the menu writes, Admin only).
 * The staff answers come from the staff-admin Edge Function, which returns the database
 * function's result plus a temporary password where one was set.
 */

const appRole = z.enum(Constants.public.Enums.app_role);

// ===== Menu =====
export const adminCategory = z.object({
  id,
  name: z.string(),
  sort_order: z.int(),
  is_active: z.boolean(),
  active_items: count,
});
export type AdminCategory = z.infer<typeof adminCategory>;

export const adminMenuItem = z.object({
  id,
  category_id: id,
  name: z.string(),
  description: z.nullable(z.string()),
  price: money,
  cost_price: money,
  prep_time_min: z.nullable(z.int()),
  needs_kitchen: z.boolean(),
  is_available: z.boolean(),
  image_path: z.nullable(z.string()),
  sort_order: z.int(),
  is_active: z.boolean(),
  updated_at: timestamp,
});
export type AdminMenuItem = z.infer<typeof adminMenuItem>;

/** admin_menu: every category and item, archived ones too. */
export const adminMenuResponse = z.object({
  categories: z.array(adminCategory),
  items: z.array(adminMenuItem),
});
export type AdminMenuResponse = z.infer<typeof adminMenuResponse>;

export const saveCategoryResponse = z.object({
  category: adminCategory,
  created: z.boolean(),
  replayed,
});
export const reorderCategoriesResponse = z.object({ category_ids: z.array(id), replayed });
export const setCategoryActiveResponse = z.object({ category: adminCategory, replayed });
export const saveMenuItemResponse = z.object({
  item: adminMenuItem,
  created: z.boolean(),
  replayed,
});
export const reorderMenuItemsResponse = z.object({
  category_id: id,
  item_ids: z.array(id),
  replayed,
});
export const setMenuItemActiveResponse = z.object({ item: adminMenuItem, replayed });

// ===== Tables =====
export const adminTable = z.object({
  id,
  number: z.int(),
  capacity: z.int(),
  section: z.string(),
  status: tableStatus,
  is_active: z.boolean(),
});
export type AdminTable = z.infer<typeof adminTable>;

export const saveTableResponse = z.object({ table: adminTable, created: z.boolean(), replayed });
export const setTableActiveResponse = z.object({ table: adminTable, replayed });

// ===== Settings =====
/** update_settings: get_settings (the Admin's view) plus replayed. */
export const updateSettingsResponse = z.extend(getSettingsResponse, { replayed });

/** preview_bill_totals (Bill check): the server's totals for typed line amounts. */
export const billCheckResponse = z.object({
  type: orderType,
  line_count: count,
  subtotal: money,
  discount: money,
  service_charge: money,
  tax: money,
  total: money,
});
export type BillCheckResponse = z.infer<typeof billCheckResponse>;

// ===== Staff =====
export const adminStaff = z.object({
  id,
  username: z.string(),
  full_name: z.string(),
  phone: z.nullable(z.string()),
  role: appRole,
  is_active: z.boolean(),
  created_at: timestamp,
});
export type AdminStaff = z.infer<typeof adminStaff>;

/** admin_staff_directory (returns a table): one row per staff member, phone included. */
export const staffDirectoryRow = z.object({
  id,
  username: z.string(),
  full_name: z.string(),
  phone: z.nullable(z.string()),
  role: appRole,
  is_active: z.boolean(),
});
export const staffDirectoryResponse = z.array(staffDirectoryRow);
export type StaffDirectoryRow = z.infer<typeof staffDirectoryRow>;

/**
 * staff-admin Edge Function. `temporary_password` is present after create and reset only, and
 * shown once; `sessions_revoked` after deactivate and reset.
 */
export const staffAdminResponse = z.object({
  staff: adminStaff,
  temporary_password: z.optional(z.string().check(z.minLength(12))),
  sessions_revoked: z.optional(count),
  replayed,
});
export type StaffAdminResponse = z.infer<typeof staffAdminResponse>;
