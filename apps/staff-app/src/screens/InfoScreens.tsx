import { Button, EmptyState, ErrorState } from '@rms/ui';
import { CircleSlash, Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useAuth } from '../auth/auth-context';
import { paths } from '../paths';

/** Signed in, but this role has no screens yet (rider: P3). */
export function NotAvailableScreen() {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  return (
    <main className="grid min-h-dvh place-items-center bg-bg text-fg">
      <EmptyState
        icon={CircleSlash}
        title={t('shell.notAvailableTitle')}
        description={t('shell.notAvailableBody')}
        action={
          <Button
            variant="outline"
            onClick={() => {
              void signOut();
            }}
          >
            {t('shell.signOut')}
          </Button>
        }
      />
    </main>
  );
}

export function NotFoundScreen() {
  const { t } = useTranslation();
  return (
    <main className="grid min-h-dvh place-items-center bg-bg text-fg">
      <EmptyState
        icon={Compass}
        title={t('shell.notFoundTitle')}
        description={t('shell.notFoundBody')}
        action={
          <Button asChild>
            <Link to={paths.home}>{t('shell.goHome')}</Link>
          </Button>
        }
      />
    </main>
  );
}

/** Unexpected render or chunk-load error (for example a deploy replaced a lazy chunk). */
export function RouteErrorScreen() {
  const { t } = useTranslation();
  return (
    <main className="grid min-h-dvh place-items-center bg-bg text-fg">
      <ErrorState
        title={t('shell.errorTitle')}
        description={t('shell.errorBody')}
        retryLabel={t('shell.reload')}
        onRetry={() => {
          window.location.reload();
        }}
      />
    </main>
  );
}
