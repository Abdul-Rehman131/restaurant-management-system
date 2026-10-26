import { useLiveTopics, type LiveTopics } from '../../lib/live';
import { menuKey } from '../../ordering/menu';
import { cashierKeys } from './data';

/**
 * The cashier's live topics (useLiveTopics). Any order or batch change refetches the open
 * bills and the open bill (ids only in the payload); table changes the table list (move,
 * Dine-In counter orders); menu changes the counter's menu (Sold Out, BR-13).
 */
const topics: LiveTopics = [
  ['staff:orders', { order_changed: cashierKeys.all, batch_changed: cashierKeys.all }],
  ['staff:tables', { table_changed: cashierKeys.tables }],
  ['staff:menu', { menu_changed: menuKey }],
];

export function useCashierLive(): void {
  useLiveTopics(topics, cashierKeys.all);
}
