import './i18n';

import { toast } from '@rms/ui';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { playTonesWhenReady, releaseWakeLock, requestWakeLock, unlockAudio } from '../lib/shift';
import { useShiftStore, type ShiftRole } from './store';

/** The short "shift started" confirmation: two soft notes, unlike every alert tone. */
const CONFIRM_NOTES = [
  [0, 660],
  [0.14, 990],
] as const;

/**
 * Starts the shift. Runs inside the tap, and never waits on the browser before the screen
 * changes: the button turns into "Shift on" and a toast confirms at once, the chime follows
 * as soon as sound is unlocked, and the wake lock answer comes from useShiftLifecycle.
 */
export function beginShift(role: ShiftRole, muted: boolean, title: string, body: string) {
  unlockAudio();
  useShiftStore.getState().setOn(role, true);
  toast.success(title, { description: body });
  if (!muted) playTonesWhenReady(CONFIRM_NOTES);
}

/**
 * While the role's shift is on: keep the screen awake (asked again whenever the tab is visible
 * again: the browser drops the lock when it is hidden), unlock sound at the first tap after a
 * reload (a remembered shift has no tap yet), and say in plain words when the screen cannot be
 * kept awake. Mount it once per role screen.
 */
export function useShiftLifecycle(role: ShiftRole): void {
  const { t } = useTranslation('shift');
  const on = useShiftStore((state) => state.on[role]);

  useEffect(() => {
    if (!on) return;
    let active = true;
    const acquire = () => {
      void requestWakeLock().then((wake) => {
        if (!active) return;
        const { announceWake, setWake, wakeAnnounced } = useShiftStore.getState();
        setWake(wake);
        if (announceWake) {
          wakeAnnounced();
          if (wake !== 'on') toast.warning(t('wakeTitle'), { description: t(`wake.${wake}`) });
        }
      });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    const onFirstGesture = () => {
      unlockAudio();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pointerdown', onFirstGesture, { capture: true, once: true });
    window.addEventListener('keydown', onFirstGesture, { capture: true, once: true });
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pointerdown', onFirstGesture, { capture: true });
      window.removeEventListener('keydown', onFirstGesture, { capture: true });
      releaseWakeLock();
    };
  }, [on, role, t]);
}

/** The wake lock state in words, for the shift menu and the waiter's Alerts tab. */
export function useWakeText(): string {
  const { t } = useTranslation('shift');
  const wake = useShiftStore((state) => state.wake);
  return wake ? t(`wake.${wake}`) : t('wake.checking');
}
