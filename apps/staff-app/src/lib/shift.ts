/**
 * A shift on a staff device (plan 4.6 rule 6, R10), shared by the role screens (never the
 * shell): "Start shift" is a tap, so the browser lets the app play sound afterwards, and it
 * asks for the Screen Wake Lock so the device stays awake. Tones are generated (Web Audio),
 * so there is nothing to download. Per-device flags (mute, shift on) live in localStorage when
 * it works.
 *
 * Nothing here may keep the button waiting (the Start shift bug, found before the client demo): a browser can leave
 * `AudioContext.resume()` pending (iOS Safari while its audio session is interrupted) and a
 * wake lock request unanswered, so both are started without being awaited by the click, and
 * the wake lock answer has a time limit.
 */

let audio: AudioContext | null = null;
let wakeLock: WakeLockSentinel | null = null;

/** How long a browser may take to answer a wake lock request before we say it did not. */
export const WAKE_LOCK_TIMEOUT_MS = 3_000;
/** How long a confirmation tone may wait for the audio to start before it is skipped. */
const AUDIO_START_TIMEOUT_MS = 1_500;

/**
 * Unlocks sound. Call it synchronously inside a tap or key press: browsers allow audio only
 * after a user gesture. Never awaited by the caller; playTones() waits for it when needed.
 */
export function unlockAudio(): void {
  try {
    audio ??= new AudioContext();
    if (audio.state !== 'running') void audio.resume().catch(() => undefined);
  } catch {
    // No Web Audio (very old browser): the shift still runs, only without sound.
    audio = null;
  }
}

/** Resolves with `fallback` if `promise` has not settled within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/**
 * The answer to "keep the screen awake", in words the screens can show:
 * - on: the screen stays awake while the app is open and visible
 * - unsupported: this browser has no Screen Wake Lock (older iOS, Firefox before 126)
 * - insecure: the page is not on https (a phone on the laptop's http://192.168... address)
 * - denied: the browser said no (battery saver, the page was not visible)
 * - timeout: the browser did not answer in time
 */
export type WakeStatus = 'on' | 'unsupported' | 'insecure' | 'denied' | 'timeout';

interface WakeEnv {
  isSecureContext: boolean;
  navigator: { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } };
}

/** Asks for the Screen Wake Lock (again, if it was lost). The env is injectable for tests. */
export async function requestWakeLock(
  env: WakeEnv = { isSecureContext: window.isSecureContext, navigator },
  timeoutMs = WAKE_LOCK_TIMEOUT_MS,
): Promise<WakeStatus> {
  if (wakeLock && !wakeLock.released) return 'on';
  if (!env.isSecureContext) return 'insecure';
  const api = env.navigator.wakeLock;
  if (!api) return 'unsupported';
  const request = api.request('screen').then(
    (sentinel) => ({ sentinel }),
    () => 'denied' as const,
  );
  const answer = await withTimeout<{ sentinel: WakeLockSentinel } | 'denied' | 'timeout'>(
    request,
    timeoutMs,
    'timeout',
  );
  if (typeof answer === 'string') {
    // A late grant after the timeout is released at once: nobody holds it.
    if (answer === 'timeout') {
      void request.then((late) => {
        if (typeof late !== 'string') void late.sentinel.release();
      });
    }
    return answer;
  }
  wakeLock = answer.sentinel;
  return 'on';
}

export function releaseWakeLock(): void {
  void wakeLock?.release().catch(() => undefined);
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

/**
 * Plays the notes as soon as the sound is unlocked (right after unlockAudio), or skips them if
 * the audio does not start within a moment: a late confirmation chime would only confuse.
 */
export function playTonesWhenReady(notes: readonly (readonly [number, number])[]): void {
  const context = audio;
  if (!context) return;
  if (context.state === 'running') {
    playTones(notes);
    return;
  }
  void withTimeout(
    context.resume().then(() => true),
    AUDIO_START_TIMEOUT_MS,
    false,
  ).then((started) => {
    if (started) playTones(notes);
  });
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
