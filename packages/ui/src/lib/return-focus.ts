import { useRef } from 'react';

type AutoFocusHandler = (event: Event) => void;

/**
 * Focus goes back to whatever opened an overlay when it closes. Radix returns focus only to its
 * own Trigger, so an overlay opened from state (a row button, a shortcut key, a menu item) left
 * focus on the page body, and a keyboard user started again from the top (S6 sweep). A caller
 * that moves focus itself calls `preventDefault()` in its own onCloseAutoFocus, as before.
 */
export function useReturnFocus(props: {
  onOpenAutoFocus?: AutoFocusHandler | undefined;
  onCloseAutoFocus?: AutoFocusHandler | undefined;
}) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus(event: Event) {
      const active = document.activeElement;
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
      props.onOpenAutoFocus?.(event);
    },
    onCloseAutoFocus(event: Event) {
      props.onCloseAutoFocus?.(event);
      if (event.defaultPrevented || !opener.current?.isConnected) return;
      event.preventDefault();
      opener.current.focus();
    },
  };
}
