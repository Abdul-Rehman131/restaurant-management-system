import { paths } from '../../paths';

/** Cashier routes (relative ones for <Routes>, absolute ones for links). */
export const cashierRoutes = { bill: 'bill/:orderId', newOrder: 'new' } as const;

export const cashierPaths = {
  bills: paths.cashier,
  bill: (orderId: string) => `${paths.cashier}/bill/${orderId}`,
  newOrder: `${paths.cashier}/new`,
} as const;
