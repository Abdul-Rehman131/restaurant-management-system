import { Button, EmptyState } from '@rms/ui';
import { Compass } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

/**
 * An unknown address inside a role area (e.g. /admin/xyz): the role's header and navigation
 * stay, the content says so and links home. NotFoundScreen is the full-page version.
 */
export function RoleNotFound({ home }: { home: string }) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={Compass}
      title={t('shell.notFoundTitle')}
      description={t('shell.notFoundBody')}
      className="py-16"
      action={
        <Button asChild>
          <Link to={home}>{t('shell.goHome')}</Link>
        </Button>
      }
    />
  );
}
