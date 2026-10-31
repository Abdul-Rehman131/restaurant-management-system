import { beforeEach, describe, expect, it, vi } from 'vitest';

// The shift is remembered per device and role (a reload keeps it on), and only Start shift
// announces the wake lock answer as a toast. A Map stands in for the device's localStorage.
const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});

describe('shift store', () => {
  it('starts off, and Start shift turns it on, remembered for this device', async () => {
    const { useShiftStore, shiftKey } = await import('./store');
    expect(useShiftStore.getState().on.kitchen).toBe(false);
    useShiftStore.getState().setOn('kitchen', true);
    expect(useShiftStore.getState().on.kitchen).toBe(true);
    expect(useShiftStore.getState().announceWake).toBe(true);
    expect(storage.get(shiftKey('kitchen'))).toBe('1');
  });

  it('a reload (a fresh store) keeps the shift on', async () => {
    storage.set('rms-waiter-shift', '1');
    const { useShiftStore } = await import('./store');
    expect(useShiftStore.getState().on.waiter).toBe(true);
    expect(useShiftStore.getState().on.cashier).toBe(false);
    // A remembered shift does not toast the wake lock answer again.
    expect(useShiftStore.getState().announceWake).toBe(false);
  });

  it('End shift turns it off, forgets it and clears the wake lock state', async () => {
    const { useShiftStore, shiftKey } = await import('./store');
    useShiftStore.getState().setOn('cashier', true);
    useShiftStore.getState().setWake('denied');
    useShiftStore.getState().setOn('cashier', false);
    expect(useShiftStore.getState().on.cashier).toBe(false);
    expect(useShiftStore.getState().wake).toBeNull();
    expect(storage.has(shiftKey('cashier'))).toBe(false);
  });

  it('works without storage (private mode): on for this session only', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    const { useShiftStore } = await import('./store');
    useShiftStore.getState().setOn('waiter', true);
    expect(useShiftStore.getState().on.waiter).toBe(true);
  });
});
