import type enUi from './locales/en/ui.json';

export {
  SUPPORTED_LANGUAGES,
  UI_NS,
  setupI18n,
  type Language,
  type SetupI18nOptions,
} from './setup';

/** Add to the app's i18next CustomTypeOptions resources so ui keys are type-checked there too. */
export interface UiResources {
  ui: typeof enUi;
}
