import { cn } from '@rms/ui';
import type { ReactNode } from 'react';

/** A key hint on a button (plan 4.8: shortcuts are shown as hints on the buttons). */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      aria-hidden
      className={cn(
        'ms-1 inline-flex h-5 min-w-5 items-center justify-center rounded border border-current/30 px-1 font-sans text-xs opacity-80',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
