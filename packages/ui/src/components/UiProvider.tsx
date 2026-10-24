import { Direction } from 'radix-ui';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { syncInertWithAriaHidden } from '../lib/inert-hidden';
import { Toaster } from './Toaster';
import { TooltipProvider } from './Tooltip';

export interface UiProviderProps {
  /** Override the reading direction (gallery). Defaults to the current language's direction. */
  dir?: 'ltr' | 'rtl' | undefined;
  children: ReactNode;
}

const NestedContext = createContext(false);

/**
 * Wrap each app once. Radix menus, tabs and sliders read the direction from here (not from
 * <html dir>), so arrow keys and placement follow RTL. Also mounts tooltips and toasts, and
 * makes content behind an open overlay inert (lib/inert-hidden.ts). A nested UiProvider (the
 * gallery) only overrides the direction.
 */
export function UiProvider({ dir, children }: UiProviderProps) {
  const { i18n } = useTranslation();
  const nested = useContext(NestedContext);
  const direction = dir ?? i18n.dir(i18n.language);
  useEffect(() => (nested ? undefined : syncInertWithAriaHidden()), [nested]);
  if (nested) return <Direction.Provider dir={direction}>{children}</Direction.Provider>;
  return (
    <NestedContext.Provider value>
      <Direction.Provider dir={direction}>
        <TooltipProvider delayDuration={300}>
          {children}
          <Toaster dir={direction} />
        </TooltipProvider>
      </Direction.Provider>
    </NestedContext.Provider>
  );
}
