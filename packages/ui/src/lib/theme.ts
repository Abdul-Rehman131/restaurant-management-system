/**
 * Light or dark theme: the `dark` class on <html>. index.html applies the saved choice before
 * first paint (key "theme"); this helper changes it at runtime.
 */
export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'theme';

export function applyTheme(theme: Theme, { persist = true } = {}) {
  const dark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  if (!persist) return;
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage can be blocked (private mode); the theme still applies for this page.
  }
}

/** Density mode for the whole app: touch (default), display (kitchen) or desk (admin). */
export type Density = 'touch' | 'display' | 'desk';

export function applyDensity(density: Density) {
  document.documentElement.dataset['density'] = density;
}
