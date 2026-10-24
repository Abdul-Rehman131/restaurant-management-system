import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enCommon from './locales/en/common.json';

// English only for now. To add a language (e.g. Urdu, RTL), add locales/<lng>/*.json, list it
// in supportedLngs, and the `dir` attribute below follows automatically.
export const defaultNS = 'common';
export const resources = {
  en: { common: enCommon },
} as const;

void i18n.use(initReactI18next).init({
  resources,
  lng: 'en',
  fallbackLng: 'en',
  supportedLngs: ['en'],
  defaultNS,
  interpolation: { escapeValue: false },
});

function applyLanguage(lng: string) {
  document.documentElement.lang = lng;
  document.documentElement.dir = i18n.dir(lng);
}

applyLanguage(i18n.language);
i18n.on('languageChanged', applyLanguage);

export default i18n;
