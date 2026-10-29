import { useLiveTopics, type LiveTopics } from '../../lib/live';
import { adminKeys } from './data';

/**
 * The Admin's live topics (useLiveTopics): menu changes refetch the menu (also Sold Out from
 * the kitchen), table changes the table grid (live status, M3), order changes the report
 * (open bills and sales on the dashboard). Ids only in the payloads.
 */
const topics: LiveTopics = [
  ['staff:menu', { menu_changed: adminKeys.menu }],
  ['staff:tables', { table_changed: adminKeys.tables }],
  ['staff:orders', { order_changed: ['admin', 'sales'], batch_changed: ['admin', 'sales'] }],
];

export function useAdminLive(): void {
  useLiveTopics(topics, adminKeys.all);
}
