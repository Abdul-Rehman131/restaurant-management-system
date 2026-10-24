import { WifiOff } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

/** The browser's network state. Realtime connection state joins it in T8. */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}

export interface OfflineBannerProps {
  /** Override (gallery, tests). Defaults to the browser's network state. */
  online?: boolean;
  className?: string;
}

/**
 * Shown while offline (plan 4.6 rule 8). Screens also disable their primary actions; the
 * cart is kept. Announced politely, once, when it appears.
 */
export function OfflineBanner({ online, className }: OfflineBannerProps) {
  const { t } = useTranslation('ui');
  const browserOnline = useOnlineStatus();
  const isOnline = online ?? browserOnline;

  return (
    <div role="status" aria-live="polite" className={className}>
      {!isOnline && (
        <div className="flex items-start gap-3 border-b border-danger/30 bg-danger-bg px-4 py-3 text-danger">
          <WifiOff aria-hidden className="mt-0.5 size-5 shrink-0" />
          <p className="font-medium">{t('connection.offlineBanner')}</p>
        </div>
      )}
    </div>
  );
}
