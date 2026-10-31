import { create } from 'zustand';

import { readFlag, writeFlag } from '../../lib/shift';
import { addRecentlyReady, type RecentlyReady, type Ticket } from './queue';

const MUTE_KEY = 'rms-kitchen-muted';

interface KitchenState {
  /** Per device, remembered (plan 4.6 rule 6). */
  muted: boolean;
  /** Tickets this screen marked Ready, newest first, so a mistaken tap stays visible. */
  recentlyReady: RecentlyReady[];
  setMuted: (muted: boolean) => void;
  markedReady: (ticket: Ticket, at: number) => void;
}

export const useKitchenStore = create<KitchenState>()((set) => ({
  muted: readFlag(MUTE_KEY),
  recentlyReady: [],
  setMuted: (muted) => {
    writeFlag(MUTE_KEY, muted);
    set({ muted });
  },
  markedReady: (ticket, at) => {
    set((state) => ({ recentlyReady: addRecentlyReady(state.recentlyReady, ticket, at) }));
  },
}));
