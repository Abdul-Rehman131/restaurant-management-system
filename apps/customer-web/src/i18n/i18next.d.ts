import 'i18next';

import type { UiResources } from '@rms/ui/i18n';

import type { defaultNS, en } from './index';

// Typed translation keys: t('missing.key') is a compile error, in this app and in packages/ui.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: typeof en & UiResources;
  }
}
