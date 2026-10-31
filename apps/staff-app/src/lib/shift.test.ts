import { afterEach, describe, expect, it, vi } from 'vitest';

import { releaseWakeLock, requestWakeLock, withTimeout } from './shift';

// The Start shift bug: the click waited on browser calls that can stay unanswered, so the
// button did nothing. These pin down that every answer (or no answer) becomes a status.

const sentinel = () =>
  ({ released: false, release: () => Promise.resolve() }) as unknown as WakeLockSentinel;
const env = (request?: () => Promise<WakeLockSentinel>, isSecureContext = true) => ({
  isSecureContext,
  navigator: request ? { wakeLock: { request } } : {},
});

afterEach(() => {
  releaseWakeLock();
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('gives the value when the promise settles in time', async () => {
    await expect(withTimeout(Promise.resolve('yes'), 100, 'late')).resolves.toBe('yes');
  });

  it('gives the fallback when the promise never settles (the hang that broke Start shift)', async () => {
    vi.useFakeTimers();
    const answer = withTimeout(new Promise<string>(() => undefined), 3_000, 'late');
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(answer).resolves.toBe('late');
  });

  it('gives the fallback when the promise rejects', async () => {
    await expect(withTimeout(Promise.reject(new Error('no')), 100, 'failed')).resolves.toBe(
      'failed',
    );
  });
});

describe('requestWakeLock', () => {
  it('is on when the browser grants it', async () => {
    await expect(requestWakeLock(env(() => Promise.resolve(sentinel())))).resolves.toBe('on');
  });

  it('says unsupported when the browser has no Screen Wake Lock', async () => {
    await expect(requestWakeLock(env())).resolves.toBe('unsupported');
  });

  it('says insecure on an http address (a phone on the laptop LAN IP), without asking', async () => {
    const request = vi.fn(() => Promise.resolve(sentinel()));
    await expect(requestWakeLock(env(request, false))).resolves.toBe('insecure');
    expect(request).not.toHaveBeenCalled();
  });

  it('says denied when the browser refuses (battery saver, page hidden)', async () => {
    const denied = () => Promise.reject(new DOMException('no', 'NotAllowedError'));
    await expect(requestWakeLock(env(denied))).resolves.toBe('denied');
  });

  it('says timeout when the browser never answers, instead of waiting forever', async () => {
    vi.useFakeTimers();
    const answer = requestWakeLock(
      env(() => new Promise<WakeLockSentinel>(() => undefined)),
      3_000,
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(answer).resolves.toBe('timeout');
  });

  it('releases a grant that arrives after the timeout (nobody holds it)', async () => {
    vi.useFakeTimers();
    const late = sentinel();
    const release = vi.spyOn(late, 'release');
    let grant: (value: WakeLockSentinel) => void = () => undefined;
    const answer = requestWakeLock(
      env(() => new Promise<WakeLockSentinel>((resolve) => (grant = resolve))),
      3_000,
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(answer).resolves.toBe('timeout');
    grant(late);
    await vi.runAllTimersAsync();
    expect(release).toHaveBeenCalled();
  });

  it('does not ask again while the lock is held', async () => {
    const request = vi.fn(() => Promise.resolve(sentinel()));
    await requestWakeLock(env(request));
    await expect(requestWakeLock(env(request))).resolves.toBe('on');
    expect(request).toHaveBeenCalledTimes(1);
  });
});
