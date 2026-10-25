import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

import { emptyDraft, type Draft } from './cart';

/**
 * Carts stay on the device until the server confirms Send (plan 4.6 rule 8): a reload, a lost
 * connection or a closed tab keeps them. One draft per waiter, table and order, so two waiters
 * on one tablet never see each other's cart.
 */
export function draftKey(userId: string, tableId: string, orderId: string | null): string {
  return `${userId}:${tableId}:${orderId ?? 'new'}`;
}

// Storage can be missing or full (private mode, cleared site data): the cart then lives only
// in memory, and nothing throws.
const safeStorage: StateStorage = {
  getItem: (name) => {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      localStorage.setItem(name, value);
    } catch {
      // Kept in memory only.
    }
  },
  removeItem: (name) => {
    try {
      localStorage.removeItem(name);
    } catch {
      // Nothing stored.
    }
  },
};

interface CartState {
  drafts: Record<string, Draft>;
  update: (key: string, change: (draft: Draft) => Draft) => void;
  clear: (key: string) => void;
}

export const useCartStore = create<CartState>()(
  persist(
    (set) => ({
      drafts: {},
      update: (key, change) => {
        set((state) => ({
          drafts: { ...state.drafts, [key]: change(state.drafts[key] ?? emptyDraft) },
        }));
      },
      clear: (key) => {
        set((state) => ({
          drafts: Object.fromEntries(Object.entries(state.drafts).filter(([k]) => k !== key)),
        }));
      },
    }),
    { name: 'rms-waiter-cart', version: 1, storage: createJSONStorage(() => safeStorage) },
  ),
);

export function useDraft(key: string): Draft {
  return useCartStore((state) => state.drafts[key]) ?? emptyDraft;
}
