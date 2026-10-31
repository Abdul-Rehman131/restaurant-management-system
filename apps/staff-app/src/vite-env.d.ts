/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  /** The publishable key (sb_publishable_...). Never a secret or service-role key. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  readonly VITE_APP_NAME?: string;
  /** Error reporting (Sentry): off when empty. A DSN is public by design (it only accepts events). */
  readonly VITE_SENTRY_DSN?: string;
  /** The commit the build came from (set in vite.config.ts), the Sentry release. */
  readonly VITE_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
