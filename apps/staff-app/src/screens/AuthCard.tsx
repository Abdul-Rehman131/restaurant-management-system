import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** Centred card for the sign-in steps (login, MFA). Touch density, the user's theme. */
export function AuthCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-4 py-10 text-fg">
      <div className="w-full max-w-sm space-y-6">
        <img
          src="/brand/logo-mark.svg"
          width={56}
          height={56}
          alt={t('app.logoLabel')}
          className="mx-auto size-14 rounded-lg"
        />
        <div className="space-y-6 rounded-xl border border-border bg-surface p-6 shadow-sm sm:p-8">
          <div className="space-y-2 text-center">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="text-fg-muted">{description}</p>}
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

/** Inline notice above a form: errors are assertive, information polite. */
export function Notice({ tone, children }: { tone: 'danger' | 'warning'; children: ReactNode }) {
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={
        tone === 'danger'
          ? 'rounded-md bg-danger-bg px-4 py-3 font-medium text-danger'
          : 'rounded-md bg-warning-bg px-4 py-3 font-medium text-warning'
      }
    >
      {children}
    </p>
  );
}
