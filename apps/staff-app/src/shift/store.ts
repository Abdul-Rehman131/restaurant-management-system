import { create } from 'zustand';

import { readFlag, writeFlag, type WakeStatus } from '../lib/shift';

/** The roles with a shift: the screens that ring and must stay awake. */
export type ShiftRole = 'waiter' | 'kitchen' | 'cashier';

/** Per device and role, so a reload or a new sign-in on this device keeps the shift on. */
export const shiftKey = (role: ShiftRole) => `rms-${role}-shift`;

interface ShiftState {
  on: Record<ShiftRole, boolean>;
  /** The latest wake lock answer while a shift is on (null: not asked yet). */
  wake: WakeStatus | null;
  /** True right after Start shift: the first wake lock answer is then also shown as a toast. */
  announceWake: boolean;
  setOn: (role: ShiftRole, on: boolean) => void;
  setWake: (wake: WakeStatus | null) => void;
  wakeAnnounced: () => void;
}

export const useShiftStore = create<ShiftState>()((set) => ({
  on: {
    waiter: readFlag(shiftKey('waiter')),
    kitchen: readFlag(shiftKey('kitchen')),
    cashier: readFlag(shiftKey('cashier')),
  },
  wake: null,
  announceWake: false,
  setOn: (role, on) => {
    writeFlag(shiftKey(role), on);
    set((state) => ({
      on: { ...state.on, [role]: on },
      wake: on ? state.wake : null,
      announceWake: on,
    }));
  },
  setWake: (wake) => {
    set({ wake });
  },
  wakeAnnounced: () => {
    set({ announceWake: false });
  },
}));

/** Whether this role's shift is on, outside React (alert handlers). */
export const shiftOn = (role: ShiftRole) => useShiftStore.getState().on[role];
