import 'i18next';

import type { UiResources } from '@rms/ui/i18n';

import type devEn from '../dev/locales/en/dev.json';
import type { defaultNS, en } from './index';

// Typed translation keys: t('missing.key') is a compile error, in this app and in packages/ui.
// `dev` is the gallery's namespace, loaded only by the development-only /dev/ui screen.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof defaultNS;
    resources: typeof en & UiResources & { dev: typeof devEn };
  }
}
