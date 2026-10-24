import { usePublicSettings } from '@rms/shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** The restaurant's local time (settings.timezone), for the kitchen bar. */
export function Clock({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  const { settings } = usePublicSettings();
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(new Date());
    }, 10_000);
    return () => {
      window.clearInterval(timer);
    };
  }, []);

  if (!settings) return null;
  const text = new Intl.DateTimeFormat(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: settings.timezone,
    numberingSystem: 'latn',
  }).format(now);

  return (
    <time dateTime={now.toISOString()} className={className}>
      {text}
    </time>
  );
}
