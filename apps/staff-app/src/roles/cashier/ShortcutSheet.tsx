import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@rms/ui';
import { useTranslation } from 'react-i18next';

/** Plan 4.8, in the order of the plan. Keys are shown as typed, so they stay literal. */
const keys = [
  ['/', 'search'],
  ['↑ ↓', 'move'],
  ['Enter', 'open'],
  ['N', 'newOrder'],
  ['P', 'pay'],
  ['1', 'cashFull'],
  ['2', 'cardFull'],
  ['S', 'split'],
  ['Ctrl+P', 'print'],
  ['Esc', 'close'],
  ['?', 'help'],
] as const;

/** The shortcut sheet (?): every cashier key with what it does. */
export function ShortcutSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['cashier', 'rpc']);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('cashier:shortcuts')}</DialogTitle>
          <DialogDescription>{t('cashier:shortcutsHint')}</DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2">
          {keys.map(([key, action]) => (
            <div key={action} className="contents">
              <dt>
                <kbd className="inline-flex h-7 min-w-9 items-center justify-center rounded-md border border-border bg-surface-2 px-2 font-mono text-sm font-semibold">
                  {key}
                </kbd>
              </dt>
              <dd>{t(`cashier:keys.${action}`)}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
