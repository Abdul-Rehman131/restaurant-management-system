import { paths } from '../../paths';

/** Waiter routes (relative ones for <Routes>, absolute ones for links). */
export const waiterRoutes = {
  table: 'table/:tableId',
  addItems: 'table/:tableId/add',
  orders: 'orders',
  alerts: 'alerts',
} as const;

export const waiterPaths = {
  tables: paths.waiter,
  table: (tableId: string) => `${paths.waiter}/table/${tableId}`,
  addItems: (tableId: string) => `${paths.waiter}/table/${tableId}/add`,
  orders: `${paths.waiter}/orders`,
  alerts: `${paths.waiter}/alerts`,
} as const;
