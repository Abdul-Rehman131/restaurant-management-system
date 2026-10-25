import { EmptyState } from '@rms/ui';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/** An empty role screen until its P1 feature lands. */
export function Placeholder({
  icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  /** Defaults to "arrives in Phase 1"; null hides it when the title already says so. */
  description?: string | null;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description === null ? undefined : (description ?? t('shell.comingInP1'))}
      action={action}
    />
  );
}
