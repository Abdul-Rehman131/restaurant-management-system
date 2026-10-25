/**
 * A shift on a staff device (plan 4.6 rule 6, R10), shared by the role screens (never the
 * shell): "Start shift" is a tap, so the browser lets the app play sound afterwards, and it
 * asks for the Screen Wake Lock so the device stays awake. Tones are generated (Web Audio),
 * so there is nothing to download. Per-device flags (mute) live in localStorage when it works.
 */

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

/** The lock ends when the page is hidden; take it again when the screen comes back. */
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

/** Plays short sine notes: [seconds from now, frequency in Hz]. Silent before Start shift. */
export function playTones(notes: readonly (readonly [number, number])[]): void {
  if (!audio || audio.state !== 'running') return;
  const start = audio.currentTime;
  for (const [offset, frequency] of notes) {
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
export function vibrate(pattern: number[]): void {
  if ('vibrate' in navigator) navigator.vibrate(pattern);
}

export function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function writeFlag(key: string, value: boolean): void {
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    // Remembered for this session only.
  }
}
