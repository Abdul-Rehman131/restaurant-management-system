import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { create } from 'zustand';

import { myOrdersQuery } from './data';
import { batchStatuses, newlyReady, type ReadyAlert } from './ready';

/**
 * Ready alerts (spec 6.1 step 4, plan 4.6 rule 6, R10). "Start shift" is a tap, so the browser
 * lets the app play sound afterwards; it also asks for the Screen Wake Lock so the phone stays
 * awake. A batch of my order that turns Ready plays a distinct tone, vibrates where the browser
 * can (not iOS) and shows a banner. Mute is per device and always visible.
 */

const MUTE_KEY = 'rms-waiter-muted';

function storedMute(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

interface AlertState {
  alerts: ReadyAlert[];
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
  bannerId: null,
  shiftStarted: false,
  wakeLock: null,
  muted: storedMute(),
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
    try {
      if (muted) localStorage.setItem(MUTE_KEY, '1');
      else localStorage.removeItem(MUTE_KEY);
    } catch {
      // Remembered for this session only.
    }
    set({ muted });
  },
}));

// ===== Sound, vibration, wake lock =====

let audio: AudioContext | null = null;
let wakeLock: WakeLockSentinel | null = null;

/** Must run inside a tap: browsers only allow sound after a user gesture. */
export async function startShift(): Promise<{ wakeLock: boolean }> {
  try {
    audio ??= new AudioContext();
    await audio.resume();
  } catch {
    audio = null;
  }
  return { wakeLock: await requestWakeLock() };
}

async function requestWakeLock(): Promise<boolean> {
  if (!('wakeLock' in navigator)) return false;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    return true;
  } catch {
    // Denied (battery saver, not visible): the in-app sound still plays while the app is open.
    return false;
  }
}

/** The lock ends when the page is hidden; take it again when the waiter comes back. */
export function reacquireWakeLockOnReturn(): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible' && wakeLock?.released !== false) {
      void requestWakeLock();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    document.removeEventListener('visibilitychange', onVisible);
  };
}

export function releaseWakeLock(): void {
  void wakeLock?.release();
  wakeLock = null;
}

/** The Ready tone: two rising notes, unlike the kitchen chime and the cashier's soft tone. */
export function playReadyTone(): void {
  if (!audio || audio.state !== 'running') return;
  const start = audio.currentTime;
  for (const [offset, frequency] of [
    [0, 880],
    [0.18, 1320],
  ] as const) {
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.4, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.3);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.32);
  }
}

/** Android browsers vibrate; iOS has no vibration API, so this does nothing there. */
export function vibrateReady(): void {
  if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
}

/**
 * Watches my orders and raises an alert for every batch that turns Ready (spec 6.1 step 4):
 * a banner and the Alerts badge always, the tone after Start shift unless muted, and a
 * vibration where the browser has one.
 */
export function useReadyAlerts(): void {
  const { data } = useQuery(myOrdersQuery);
  const previous = useRef<Map<string, string> | null>(null);

  useEffect(() => {
    if (!data) return;
    if (previous.current) {
      const fresh = newlyReady(previous.current, data, Date.now());
      if (fresh.length > 0) {
        const { push, muted, shiftStarted } = useAlertStore.getState();
        push(fresh);
        if (shiftStarted && !muted) playReadyTone();
        vibrateReady();
      }
    }
    previous.current = batchStatuses(data);
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
