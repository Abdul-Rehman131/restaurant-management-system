import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { create } from 'zustand';

import {
  playTones,
  readFlag,
  reacquireWakeLockOnReturn,
  releaseWakeLock,
  vibrate,
  writeFlag,
} from '../../lib/shift';
import { myOrdersQuery } from './data';
import { newlyReady, readyBatches, type ReadyAlert } from './ready';

/**
 * Ready alerts (spec 6.1 step 4, plan 4.6 rule 6, R10). "Start shift" is a tap, so the browser
 * lets the app play sound afterwards; it also asks for the Screen Wake Lock so the phone stays
 * awake. A batch of my order that turns Ready plays a distinct tone, vibrates where the browser
 * can (not iOS) and shows a banner. Mute is per device and always visible.
 */

const MUTE_KEY = 'rms-waiter-muted';

interface AlertState {
  alerts: ReadyAlert[];
  /**
   * Batches that may not ring (already Ready at the first look, or already rung). In the
   * store, not the component, so a remount of the waiter screens never resets it.
   */
  known: ReadonlySet<string> | null;
  remember: (ids: Iterable<string>) => void;
  /** The alert shown in the banner, until it is opened or dismissed. */
  bannerId: string | null;
  shiftStarted: boolean;
  /** Whether the screen is kept awake (null before Start shift). */
  wakeLock: boolean | null;
  muted: boolean;
  push: (alerts: ReadyAlert[]) => void;
  dismissBanner: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  setShiftStarted: (started: boolean, wakeLock: boolean | null) => void;
  setMuted: (muted: boolean) => void;
}

export const useAlertStore = create<AlertState>()((set) => ({
  alerts: [],
  known: null,
  remember: (ids) => {
    set((state) => ({ known: new Set([...(state.known ?? []), ...ids]) }));
  },
  bannerId: null,
  shiftStarted: false,
  wakeLock: null,
  muted: readFlag(MUTE_KEY),
  push: (fresh) => {
    set((state) => {
      const known = new Set(state.alerts.map((a) => a.id));
      const added = fresh.filter((a) => !known.has(a.id));
      if (added.length === 0) return state;
      return {
        alerts: [...added, ...state.alerts].slice(0, 50),
        bannerId: added[0]?.id ?? state.bannerId,
      };
    });
  },
  dismissBanner: () => {
    set({ bannerId: null });
  },
  markRead: (id) => {
    set((state) => ({
      alerts: state.alerts.map((a) => (a.id === id ? { ...a, read: true } : a)),
      bannerId: state.bannerId === id ? null : state.bannerId,
    }));
  },
  markAllRead: () => {
    set((state) => ({ alerts: state.alerts.map((a) => ({ ...a, read: true })), bannerId: null }));
  },
  setShiftStarted: (shiftStarted, wakeLock) => {
    set({ shiftStarted, wakeLock });
  },
  setMuted: (muted) => {
    writeFlag(MUTE_KEY, muted);
    set({ muted });
  },
}));

/** The Ready tone: two rising notes, unlike the kitchen chime and the cashier's soft tone. */
export function playReadyTone(): void {
  playTones([
    [0, 880],
    [0.18, 1320],
  ]);
}

/** Android browsers vibrate; iOS has no vibration API, so this does nothing there. */
export function vibrateReady(): void {
  vibrate([200, 100, 200]);
}

/**
 * Watches my orders and raises an alert for every batch that turns Ready (spec 6.1 step 4):
 * a banner and the Alerts badge always, the tone after Start shift unless muted, and a
 * vibration where the browser has one.
 */
export function useReadyAlerts(): void {
  const { data } = useQuery(myOrdersQuery);

  useEffect(() => {
    if (!data) return;
    const { known, remember, push, muted, shiftStarted } = useAlertStore.getState();
    if (!known) {
      remember(readyBatches(data));
      return;
    }
    const fresh = newlyReady(known, data, Date.now());
    if (fresh.length === 0) return;
    remember(fresh.map((alert) => alert.id));
    push(fresh);
    if (shiftStarted && !muted) playReadyTone();
    vibrateReady();
  }, [data]);

  // Keep the screen awake for the whole shift (R10).
  const shiftStarted = useAlertStore((state) => state.shiftStarted);
  useEffect(() => {
    if (!shiftStarted) return;
    const stop = reacquireWakeLockOnReturn();
    return () => {
      stop();
      releaseWakeLock();
    };
  }, [shiftStarted]);
}
