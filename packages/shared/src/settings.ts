import { createContext, createElement, useContext, useEffect, type ReactNode } from 'react';

/**
 * Business values shown in the UI. They come ONLY from the `settings` table (via the
 * get_settings RPC), never from constants in code.
 */
export interface PublicSettings {
  restaurantName: string;
  currencyCode: string;
  /** Digits after the decimal point for currencyCode (settings.currency_minor_units). */
  currencyMinorUnits: number;
  /** Basis points: 1600 = 16%. */
  taxBps: number;
  serviceChargeBps: number;
  receiptFooter: string | null;
}

export interface PublicSettingsState {
  settings: PublicSettings | null;
  loading: boolean;
}

const SettingsContext = createContext<PublicSettingsState>({ settings: null, loading: false });

/**
 * Supplies settings to every screen. T8 feeds it from the get_settings query; until then, and
 * outside the provider, there are no settings and screens show no name or amounts.
 */
export function PublicSettingsProvider({
  value,
  children,
}: {
  value: PublicSettingsState;
  children: ReactNode;
}) {
  return createElement(SettingsContext.Provider, { value }, children);
}

export function usePublicSettings(): PublicSettingsState {
  return useContext(SettingsContext);
}

/** Sets document.title to "<restaurant> · <screen>", or just "<screen>" before settings load. */
export function useDocumentTitle(screenTitle: string, restaurantName?: string): void {
  useEffect(() => {
    document.title = restaurantName ? `${restaurantName} · ${screenTitle}` : screenTitle;
  }, [screenTitle, restaurantName]);
}
