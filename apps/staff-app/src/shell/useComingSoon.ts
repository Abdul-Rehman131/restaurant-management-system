import { toast } from '@rms/ui';
import { useTranslation } from 'react-i18next';

/** Primary actions do nothing yet: they say when they arrive. */
export function useComingSoon() {
  const { t } = useTranslation();
  return () => {
    toast(t('shell.comingInP1'));
  };
}
