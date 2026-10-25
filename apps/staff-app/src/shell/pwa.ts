import { toast } from '@rms/ui';
import { registerSW } from 'virtual:pwa-register';

import i18n from '../i18n';

/**
 * Registers the service worker (production builds). A new version never replaces the running
 * one by itself, which could interrupt an order: staff see a toast and choose when to update.
 */
export function registerPwa() {
  const updateServiceWorker = registerSW({
    onNeedRefresh() {
      toast(i18n.t('shell.updateReady'), {
        id: 'pwa-update',
        duration: Infinity,
        action: {
          label: i18n.t('shell.updateNow'),
          onClick: () => {
            void updateServiceWorker(true);
          },
        },
      });
    },
    onOfflineReady() {
      toast(i18n.t('shell.offlineReady'), { id: 'pwa-offline-ready' });
    },
  });
}
