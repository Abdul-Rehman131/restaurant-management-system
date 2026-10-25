import 'i18next';

import type { UiResources } from '@rms/ui/i18n';

import type devEn from '../dev/locales/en/dev.json';
import type cashierEn from './locales/en/cashier.json';
import type kitchenEn from './locales/en/kitchen.json';
import type orderingEn from './locales/en/ordering.json';
import type rpcEn from './locales/en/rpc.json';
import type waiterEn from './locales/en/waiter.json';
import type { defaultNS, en } from './index';

// Typed translation keys: t('missing.key') is a compile error, in this app and in packages/ui.
// `dev` is the gallery's namespace, loaded only by the development-only /dev/ui screen;
// `waiter`, `kitchen`, `cashier`, `ordering` and `rpc` load with the role chunks
// (src/roles/*/i18n.ts, src/ordering/i18n.ts, src/i18n/rpc.ts).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: typeof en &
      UiResources & {
        cashier: typeof cashierEn;
        dev: typeof devEn;
        kitchen: typeof kitchenEn;
        ordering: typeof orderingEn;
        rpc: typeof rpcEn;
        waiter: typeof waiterEn;
      };
  }
}
