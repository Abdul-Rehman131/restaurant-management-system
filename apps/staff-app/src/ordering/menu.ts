import { rpc } from '@rms/shared';
import { queryOptions } from '@tanstack/react-query';
import * as z from 'zod/mini';

import { db } from '../lib/db';
import { RpcContractError } from '../lib/rpc';

/**
 * The active menu for order entry (waiter and counter), shared by the role chunks that take
 * orders (never the shell). A plain select that RLS limits: active rows for a waiter, no
 * cost_price for anyone (the column is not granted, G6). Parsed with Zod.
 */
export const menuKey = ['menu'] as const;

function parse<S extends z.ZodMiniType>(source: string, schema: S, data: unknown): z.infer<S> {
  const result = z.safeParse(schema, data);
  if (!result.success) throw new RpcContractError(source, result.error);
  return result.data;
}

const category = z.object({ id: rpc.id, name: z.string(), sort_order: z.int() });
const menuItem = z.object({
  id: rpc.id,
  category_id: rpc.id,
  name: z.string(),
  description: z.nullable(z.string()),
  price: rpc.money,
  needs_kitchen: z.boolean(),
  is_available: z.boolean(),
  sort_order: z.int(),
});
const menu = z.object({ categories: z.array(category), items: z.array(menuItem) });
export type MenuCategory = z.infer<typeof category>;
export type MenuItem = z.infer<typeof menuItem>;
export type Menu = z.infer<typeof menu>;

/** The last menu on this device, so search and browsing work offline (plan 4.6 rule 9). */
const MENU_CACHE_KEY = 'rms-menu';

function cachedMenu(): Menu | undefined {
  try {
    const raw = localStorage.getItem(MENU_CACHE_KEY);
    if (!raw) return undefined;
    const result = z.safeParse(menu, JSON.parse(raw));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export const menuQuery = queryOptions({
  queryKey: menuKey,
  queryFn: async (): Promise<Menu> => {
    // Active menu only (BR-14): RLS gives a waiter active rows; the filters say so explicitly.
    // No cost_price: the column is not granted (G6), and it is not asked for.
    const [categories, items] = await Promise.all([
      db
        .from('categories')
        .select('id, name, sort_order')
        .eq('is_active', true)
        .order('sort_order'),
      db
        .from('menu_items')
        .select(
          'id, category_id, name, description, price, needs_kitchen, is_available, sort_order',
        )
        .eq('is_active', true)
        .order('sort_order'),
    ]);
    if (categories.error) throw categories.error;
    if (items.error) throw items.error;
    const result = parse('menu', menu, { categories: categories.data, items: items.data });
    // Items of an archived category are not on the menu either.
    const active = new Set(result.categories.map((c) => c.id));
    const fresh = { ...result, items: result.items.filter((i) => active.has(i.category_id)) };
    try {
      localStorage.setItem(MENU_CACHE_KEY, JSON.stringify(fresh));
    } catch {
      // Private mode or full storage: the menu still works while the app is open.
    }
    return fresh;
  },
  initialData: cachedMenu,
  // The cached copy is only for the first paint and offline use: always refetch it.
  initialDataUpdatedAt: 0,
});
