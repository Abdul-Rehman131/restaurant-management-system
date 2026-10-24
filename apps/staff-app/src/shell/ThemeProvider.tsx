import { applyDensity, applyTheme, type Theme } from '@rms/ui';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import { ThemeContext, type Appearance } from './theme-context';

function savedTheme(): Theme {
  try {
    const value = localStorage.getItem('theme');
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Light, dark or system theme (saved per device; index.html applies it before first paint),
 * plus the density and forced theme of the current screen.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(savedTheme);
  const [appearance, setAppearance] = useState<Appearance>({ density: 'touch' });

  useEffect(() => {
    applyTheme(appearance.theme ?? theme, { persist: false });
    applyDensity(appearance.density);
  }, [theme, appearance]);

  // Follow the system setting live while the choice is "system".
  useEffect(() => {
    if (theme !== 'system' || appearance.theme) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      applyTheme('system', { persist: false });
    };
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, [theme, appearance.theme]);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const value = useMemo(() => ({ theme, setTheme, setAppearance }), [theme, setTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
