import { Direction } from 'radix-ui';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export interface UiProviderProps {
  /** Override the reading direction (gallery). Defaults to the current language's direction. */
  dir?: 'ltr' | 'rtl' | undefined;
  children: ReactNode;
}

/**
 * Wrap each app once. Radix menus, tabs and sliders read the direction from here (not from
 * <html dir>), so arrow keys and placement follow RTL.
 */
export function UiProvider({ dir, children }: UiProviderProps) {
  const { i18n } = useTranslation();
  return <Direction.Provider dir={dir ?? i18n.dir(i18n.language)}>{children}</Direction.Provider>;
}
