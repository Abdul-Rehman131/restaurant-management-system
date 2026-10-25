import { create } from 'zustand';

import { readFlag, writeFlag } from '../../lib/shift';

const MUTE_KEY = 'rms-cashier-muted';
const AUTO_PRINT_KEY = 'rms-cashier-auto-print';

/** Keyboard actions the open bill offers (plan 4.8); null when there is nothing to do. */
export interface BillShortcuts {
  pay?: () => void;
  cashFull?: () => void;
  cardFull?: () => void;
  split?: () => void;
  print?: () => void;
}

interface CashierState {
  shiftStarted: boolean;
  wakeLock: boolean | null;
  /** Per device, remembered (plan 4.6 rule 6). */
  muted: boolean;
  /** Print the receipt right after a payment (plan 4.9), per device. */
  autoPrint: boolean;
  /** Orders that already had the bill requested at the first look, plus those since seen. */
  knownRequests: ReadonlySet<string> | null;
  /** New bill requests not opened yet: the header badge. */
  unreadRequests: ReadonlySet<string>;
  /** The latest new bill request, announced politely. */
  lastRequest: string | null;
  shortcuts: BillShortcuts;
  setShiftStarted: (wakeLock: boolean) => void;
  setMuted: (muted: boolean) => void;
  setAutoPrint: (autoPrint: boolean) => void;
  rememberRequests: (ids: Iterable<string>, unread: boolean) => void;
  markRequestRead: (orderId: string) => void;
  setShortcuts: (shortcuts: BillShortcuts) => void;
}

export const useCashierStore = create<CashierState>()((set) => ({
  shiftStarted: false,
  wakeLock: null,
  muted: readFlag(MUTE_KEY),
  autoPrint: readFlag(AUTO_PRINT_KEY),
  knownRequests: null,
  unreadRequests: new Set(),
  lastRequest: null,
  shortcuts: {},
  setShiftStarted: (wakeLock) => {
    set({ shiftStarted: true, wakeLock });
  },
  setMuted: (muted) => {
    writeFlag(MUTE_KEY, muted);
    set({ muted });
  },
  setAutoPrint: (autoPrint) => {
    writeFlag(AUTO_PRINT_KEY, autoPrint);
    set({ autoPrint });
  },
  rememberRequests: (ids, unread) => {
    set((state) => {
      const list = [...ids];
      return {
        knownRequests: new Set([...(state.knownRequests ?? []), ...list]),
        unreadRequests: unread ? new Set([...state.unreadRequests, ...list]) : state.unreadRequests,
        lastRequest: unread ? (list[0] ?? state.lastRequest) : state.lastRequest,
      };
    });
  },
  markRequestRead: (orderId) => {
    set((state) => {
      if (!state.unreadRequests.has(orderId)) return state;
      const unreadRequests = new Set(state.unreadRequests);
      unreadRequests.delete(orderId);
      return { unreadRequests };
    });
  },
  setShortcuts: (shortcuts) => {
    set({ shortcuts });
  },
}));
