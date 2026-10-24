import 'i18next';

import type { UiResources } from './index';

// Typed keys while type-checking packages/ui on its own. Inside an app, the app's declaration
// (which includes UiResources) applies instead. Components always name the namespace:
// useTranslation('ui').
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'ui';
    resources: UiResources;
  }
}
