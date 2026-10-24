import { useEffect } from 'react';

/**
 * Business values shown in the UI. They come ONLY from the `settings` table, never from
 * constants in code. Replaced by the generated database types in T4.
 */
export interface PublicSettings {
  restaurantName: string;
  currencyCode: string;
  /** Basis points: 1600 = 16%. */
  taxBps: number;
  serviceChargeBps: number;
  receiptFooter: string | null;
}

export interface PublicSettingsState {
  settings: PublicSettings | null;
  loading: boolean;
}

/**
 * Reads the public settings row. The Supabase query is connected in T8, once the table (T4)
 * and the client exist. Until then it returns no settings, and screens show no name.
 */
export function usePublicSettings(): PublicSettingsState {
  return { settings: null, loading: false };
}

/** Sets document.title to "<restaurant> · <screen>", or just "<screen>" before settings load. */
export function useDocumentTitle(screenTitle: string, restaurantName?: string): void {
  useEffect(() => {
    document.title = restaurantName ? `${restaurantName} · ${screenTitle}` : screenTitle;
  }, [screenTitle, restaurantName]);
}
