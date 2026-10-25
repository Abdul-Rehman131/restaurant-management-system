import { setupI18n } from '@rms/ui/i18n';

import enCommon from './locales/en/common.json';

// English is bundled. Other languages are lazy-loaded from locales/<lng>/*.json (Urdu is a
// stub until requested, D9); `dir` on <html> follows the language. The `ui` namespace of the
// shared components is added by setupI18n.
export const defaultNS = 'common';
export const en = { common: enCommon } as const;

export default setupI18n({
  defaultNS,
  en,
  lazy: import.meta.glob(['./locales/*/*.json', '!./locales/en/*.json']),
});
