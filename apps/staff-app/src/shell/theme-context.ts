import type { Density, Theme } from '@rms/ui';
import { createContext, useContext, useEffect } from 'react';

export interface Appearance {
  /** Forced theme for a screen (the kitchen is always dark). Unset: the user's choice. */
  theme?: 'light' | 'dark';
  density: Density;
}

export interface ThemeContextValue {
  /** The user's choice, saved on this device. */
  theme: Theme;
  setTheme: (theme: Theme) => void;
  setAppearance: (appearance: Appearance) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}

/** A screen declares its density (and, for the kitchen, a forced theme) while it is shown. */
export function useScreenAppearance(appearance: Appearance): void {
  const { setAppearance } = useTheme();
  const { theme, density } = appearance;
  useEffect(() => {
    setAppearance(theme ? { theme, density } : { density });
  }, [setAppearance, theme, density]);
}
