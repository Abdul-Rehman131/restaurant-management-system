import { getSettingsResponse, rpc } from '@rms/shared';
import type { PostgrestError } from '@supabase/postgrest-js';
import { queryOptions } from '@tanstack/react-query';
import * as z from 'zod/mini';

import { db } from '../../lib/db';
import { supabaseKey, supabaseUrl } from '../../lib/env';
import { RpcContractError } from '../../lib/rpc';
import { accessToken } from '../../lib/supabase';

/**
 * The Admin's server data (S5). Reads: admin_menu (cost prices, Admin only), plain selects RLS
 * allows the Admin (tables), admin_staff_directory, get_settings, get_sales_summary. Writes:
 * only the Admin RPCs, each with a request id (BR-15), and the staff-admin Edge Function for
 * logins. Every answer is parsed with its Zod schema (ADR 002). Photos go straight to Storage
 * (menu-images bucket, Admin aal2 only), then their path is saved with the item.
 */
export const adminKeys = {
  all: ['admin'] as const,
  menu: ['admin', 'menu'] as const,
  tables: ['admin', 'tables'] as const,
  staff: ['admin', 'staff'] as const,
  settings: ['admin', 'settings'] as const,
  sales: (businessDate: string | null) => ['admin', 'sales', businessDate ?? 'today'] as const,
};

function parse<S extends z.ZodMiniType>(source: string, schema: S, data: unknown): z.infer<S> {
  const result = z.safeParse(schema, data);
  if (!result.success) throw new RpcContractError(source, result.error);
  return result.data;
}

async function call<S extends z.ZodMiniType>(
  fn: string,
  schema: S,
  request: PromiseLike<{ data: unknown; error: PostgrestError | null }>,
): Promise<z.infer<S>> {
  const { data, error } = await request;
  if (error) throw error;
  return parse(fn, schema, data);
}

// ===== Reads =====

export const menuQuery = queryOptions({
  queryKey: adminKeys.menu,
  queryFn: () => call('admin_menu', rpc.adminMenuResponse, db.rpc('admin_menu')),
});

export const tablesQuery = queryOptions({
  queryKey: adminKeys.tables,
  queryFn: async () => {
    const { data, error } = await db
      .from('restaurant_tables')
      .select('id, number, capacity, section, status, is_active')
      .order('number');
    if (error) throw error;
    return parse('restaurant_tables', z.array(rpc.adminTable), data);
  },
});

export const staffQuery = queryOptions({
  queryKey: adminKeys.staff,
  queryFn: () =>
    call('admin_staff_directory', rpc.staffDirectoryResponse, db.rpc('admin_staff_directory')),
});

export const settingsQuery = queryOptions({
  queryKey: adminKeys.settings,
  queryFn: () => call('get_settings', getSettingsResponse, db.rpc('get_settings')),
});
export type AdminSettings = z.infer<typeof getSettingsResponse>;

export const salesQuery = (businessDate: string | null) =>
  queryOptions({
    queryKey: adminKeys.sales(businessDate),
    queryFn: () =>
      call(
        'get_sales_summary',
        rpc.salesSummaryResponse,
        db.rpc('get_sales_summary', businessDate ? { p_business_date: businessDate } : {}),
      ),
  });

// ===== Writes (each takes the request id first, BR-15) =====

export interface ItemInput {
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  cost_price: number;
  prep_time_min: number | null;
  needs_kitchen: boolean;
  is_available: boolean;
  image_path: string | null;
}

export const adminRpc = {
  saveCategory: (requestId: string, categoryId: string | null, name: string) =>
    call(
      'save_category',
      rpc.saveCategoryResponse,
      db.rpc('save_category', {
        p_request_id: requestId,
        p_category_id: categoryId as string,
        p_name: name,
      }),
    ),
  reorderCategories: (requestId: string, categoryIds: string[]) =>
    call(
      'reorder_categories',
      rpc.reorderCategoriesResponse,
      db.rpc('reorder_categories', { p_request_id: requestId, p_category_ids: categoryIds }),
    ),
  setCategoryActive: (requestId: string, categoryId: string, active: boolean, reason: string) =>
    call(
      'set_category_active',
      rpc.setCategoryActiveResponse,
      db.rpc('set_category_active', {
        p_request_id: requestId,
        p_category_id: categoryId,
        p_is_active: active,
        p_reason: reason,
      }),
    ),
  saveMenuItem: (requestId: string, itemId: string | null, item: ItemInput) =>
    call(
      'save_menu_item',
      rpc.saveMenuItemResponse,
      db.rpc('save_menu_item', {
        p_request_id: requestId,
        p_menu_item_id: itemId as string,
        p_item: { ...item },
      }),
    ),
  reorderMenuItems: (requestId: string, categoryId: string, itemIds: string[]) =>
    call(
      'reorder_menu_items',
      rpc.reorderMenuItemsResponse,
      db.rpc('reorder_menu_items', {
        p_request_id: requestId,
        p_category_id: categoryId,
        p_item_ids: itemIds,
      }),
    ),
  setMenuItemActive: (requestId: string, itemId: string, active: boolean, reason: string) =>
    call(
      'set_menu_item_active',
      rpc.setMenuItemActiveResponse,
      db.rpc('set_menu_item_active', {
        p_request_id: requestId,
        p_menu_item_id: itemId,
        p_is_active: active,
        p_reason: reason,
      }),
    ),
  setItemAvailability: (requestId: string, itemId: string, available: boolean) =>
    call(
      'set_item_availability',
      rpc.setItemAvailabilityResponse,
      db.rpc('set_item_availability', {
        p_request_id: requestId,
        p_menu_item_id: itemId,
        p_is_available: available,
      }),
    ),
  saveTable: (
    requestId: string,
    tableId: string | null,
    table: { number: number; capacity: number; section: string },
  ) =>
    call(
      'save_table',
      rpc.saveTableResponse,
      db.rpc('save_table', {
        p_request_id: requestId,
        p_table_id: tableId as string,
        p_number: table.number,
        p_capacity: table.capacity,
        p_section: table.section,
      }),
    ),
  setTableActive: (requestId: string, tableId: string, active: boolean, reason: string) =>
    call(
      'set_table_active',
      rpc.setTableActiveResponse,
      db.rpc('set_table_active', {
        p_request_id: requestId,
        p_table_id: tableId,
        p_is_active: active,
        p_reason: reason,
      }),
    ),
  updateSettings: (requestId: string, changes: Partial<AdminSettings>) =>
    call(
      'update_settings',
      rpc.updateSettingsResponse,
      db.rpc('update_settings', { p_request_id: requestId, p_changes: changes }),
    ),
  billCheck: (type: 'dine_in' | 'take_away' | 'delivery', lines: number[], discount: number) =>
    call(
      'preview_bill_totals',
      rpc.billCheckResponse,
      db.rpc('preview_bill_totals', {
        p_type: type,
        p_line_amounts: lines,
        p_discount: discount,
      }),
    ),
};

// ===== Staff (the staff-admin Edge Function: logins need the service key) =====

export type StaffAction =
  | {
      action: 'create';
      username: string;
      full_name: string;
      phone: string | null;
      role: string;
    }
  | { action: 'update'; user_id: string; full_name: string; phone: string | null; role: string }
  | { action: 'set_active'; user_id: string; is_active: boolean; reason: string | null }
  | { action: 'reset_password'; user_id: string }
  | { action: 'reset_mfa'; user_id: string };

/**
 * Calls staff-admin with the Admin's access token. Its error answer {"error": CODE} is thrown
 * as an Error whose message is CODE, so rpcErrorKey maps it like an RPC error; a failed
 * fetch stays a network error (retry with the same request id).
 */
export async function staffAdmin(requestId: string, body: StaffAction) {
  const token = await accessToken();
  const response = await fetch(`${supabaseUrl}/functions/v1/staff-admin`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...body, request_id: requestId }),
  });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (data as { error?: unknown } | null)?.error;
    throw new Error(typeof code === 'string' ? code : 'unknown');
  }
  return parse('staff-admin', rpc.staffAdminResponse, data);
}

// ===== Photos (Storage, menu-images bucket) =====

/** The public URL of a menu photo (the bucket is public; the name is items/<uuid>.webp). */
export function photoUrl(path: string): string {
  return `${supabaseUrl}/storage/v1/object/public/menu-images/${path}`;
}

/**
 * Uploads a WebP photo under a new random name (never overwrites, so cached URLs stay right)
 * and returns its path for save_menu_item. Errors: IMAGE_UPLOAD_FAILED or a network error.
 */
export async function uploadPhoto(photo: Blob, newId: () => string): Promise<string> {
  const path = `items/${newId()}.webp`;
  const token = await accessToken();
  const response = await fetch(`${supabaseUrl}/storage/v1/object/menu-images/${path}`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      'Content-Type': 'image/webp',
      'x-upsert': 'false',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: photo,
  });
  if (!response.ok) throw new Error('IMAGE_UPLOAD_FAILED');
  return path;
}
