import { create } from 'zustand';

import type { MyOrder } from './data';

/**
 * Ready alerts (spec 6.1 step 4, plan 4.6 rule 6, R10). "Start shift" is a tap, so the browser
 * lets the app play sound afterwards; it also asks for the Screen Wake Lock so the phone stays
 * awake. A batch of my order that turns Ready plays a distinct tone, vibrates where the browser
 * can (not iOS) and shows a banner. Mute is per device and always visible.
 */

export interface ReadyAlert {
  /** The batch id: one alert per batch. */
  id: string;
  orderId: string;
  tableId: string | null;
  batchNo: number;
  at: number;
  read: boolean;
}

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
  muted: boolean;
  push: (alerts: ReadyAlert[]) => void;
  dismissBanner: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  setShiftStarted: (started: boolean) => void;
  setMuted: (muted: boolean) => void;
}

export const useAlertStore = create<AlertState>()((set) => ({
  alerts: [],
  bannerId: null,
  shiftStarted: false,
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
  setShiftStarted: (shiftStarted) => {
    set({ shiftStarted });
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

/**
 * Batches that turned Ready since the last look. A batch counts only when it was seen before
 * in another status, so opening the app never replays old alerts, and a drinks-only add-on
 * (Ready at once, BR-07) never rings.
 */
export function newlyReady(
  previous: ReadonlyMap<string, string>,
  orders: readonly MyOrder[],
  now: number,
): ReadyAlert[] {
  const alerts: ReadyAlert[] = [];
  for (const order of orders) {
    for (const batch of order.order_batches) {
      const before = previous.get(batch.id);
      if (batch.status === 'ready' && before !== undefined && before !== 'ready') {
        alerts.push({
          id: batch.id,
          orderId: order.id,
          tableId: order.table_id,
          batchNo: batch.batch_no,
          at: now,
          read: false,
        });
      }
    }
  }
  return alerts;
}

export function batchStatuses(orders: readonly MyOrder[]): Map<string, string> {
  return new Map(orders.flatMap((o) => o.order_batches.map((b) => [b.id, b.status] as const)));
}

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
