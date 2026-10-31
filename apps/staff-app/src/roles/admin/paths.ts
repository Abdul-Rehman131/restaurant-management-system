import { paths } from '../../paths';

/** Admin routes (relative ones for <Routes>, absolute ones for links). */
export const adminRoutes = {
  menu: 'menu',
  newItem: 'menu/new',
  item: 'menu/:itemId',
  categories: 'categories',
  tables: 'tables',
  staff: 'staff',
  settings: 'settings',
  billCheck: 'bill-check',
} as const;

export const adminPaths = {
  dashboard: paths.admin,
  menu: `${paths.admin}/menu`,
  newItem: `${paths.admin}/menu/new`,
  item: (itemId: string) => `${paths.admin}/menu/${itemId}`,
  categories: `${paths.admin}/categories`,
  tables: `${paths.admin}/tables`,
  staff: `${paths.admin}/staff`,
  settings: `${paths.admin}/settings`,
  billCheck: `${paths.admin}/bill-check`,
} as const;
