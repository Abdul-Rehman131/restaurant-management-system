import { useLiveTopics, type LiveTopics } from '../../lib/live';
import { kitchenKeys } from './data';

/**
 * The kitchen's live topics (useLiveTopics): staff:kitchen for new and changed orders and
 * batches, staff:menu for Sold Out changes made elsewhere (BR-13). Payloads are ids only.
 */
const topics: LiveTopics = [
  ['staff:kitchen', { order_changed: kitchenKeys.queue, batch_changed: kitchenKeys.queue }],
  ['staff:menu', { menu_changed: kitchenKeys.menu }],
];

export function useKitchenLive(): void {
  useLiveTopics(topics, kitchenKeys.all);
}
