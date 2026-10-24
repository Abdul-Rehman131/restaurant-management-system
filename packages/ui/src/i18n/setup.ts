import i18n, { type BackendModule, type ResourceKey } from 'i18next';
import { initReactI18next } from 'react-i18next';

import enUi from './locales/en/ui.json';

/**
 * Languages the apps can switch to. English is bundled; every other language is lazy-loaded
 * from locales/<lng>/<ns>.json when selected. Urdu is a stub until the owner asks for it (D9):
 * its missing keys fall back to English, but the layout already turns RTL.
 */
export const SUPPORTED_LANGUAGES = ['en', 'ur'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const UI_NS = 'ui';

type LocaleLoader = () => Promise<unknown>;

/** './locales/ur/common.json' -> 'ur/common' */
function byLanguageAndNamespace(loaders: Record<string, LocaleLoader>) {
  return Object.fromEntries(
    Object.entries(loaders).flatMap(([path, load]) => {
      const match = /locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
      return match ? [[`${match[1] ?? ''}/${match[2] ?? ''}`, load] as const] : [];
    }),
  );
}

const uiLoaders = import.meta.glob(['./locales/*/*.json', '!./locales/en/*.json']);

function lazyLocales(loaders: Record<string, LocaleLoader>): BackendModule {
  return {
    type: 'backend',
    init() {},
    read(language, namespace, callback) {
      const load = loaders[`${language}/${namespace}`];
      if (!load) {
        callback(null, {});
        return;
      }
      load().then(
        (module) => {
          callback(null, (module as { default: ResourceKey }).default);
        },
        (error: unknown) => {
          callback(error instanceof Error ? error : new Error(String(error)), null);
        },
      );
    },
  };
}

export interface SetupI18nOptions {
  defaultNS: string;
  /** The app's English namespaces, bundled. */
  en: Record<string, ResourceKey>;
  /** import.meta.glob(['./locales/*\/*.json', '!./locales/en/*.json']) from the app. */
  lazy: Record<string, LocaleLoader>;
}

/** Initialises i18next for an app. `dir` and `lang` on <html> follow the language. */
export function setupI18n({ defaultNS, en, lazy }: SetupI18nOptions) {
  void i18n
    .use(lazyLocales(byLanguageAndNamespace({ ...uiLoaders, ...lazy })))
    .use(initReactI18next)
    .init({
      resources: { en: { ...en, [UI_NS]: enUi } },
      partialBundledLanguages: true,
      lng: 'en',
      fallbackLng: 'en',
      supportedLngs: SUPPORTED_LANGUAGES,
      ns: [defaultNS, UI_NS],
      defaultNS,
      interpolation: { escapeValue: false },
    });

  const applyLanguage = (language: string) => {
    document.documentElement.lang = language;
    document.documentElement.dir = i18n.dir(language);
  };
  applyLanguage(i18n.language);
  i18n.on('languageChanged', applyLanguage);

  return i18n;
}
