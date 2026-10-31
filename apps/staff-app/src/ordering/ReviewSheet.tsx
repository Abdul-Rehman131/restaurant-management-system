import {
  Input,
  QtyStepper,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@rms/ui';
import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { RpcErrorKey } from '../lib/rpc';
import { MAX_NOTES, removeLine, setNotes, setQuantity } from './cart';
import './i18n';
import { useCartStore, useDraft } from './cart-store';

/**
 * Review before Send (plan 4.11): every line with its quantity, remove, and a note for the
 * kitchen ("no onion"). No amounts: the total comes from the server on Send (BR-01).
 */
export function ReviewSheet({
  open,
  onOpenChange,
  title,
  draftKey,
  unavailable,
  error,
  onEdit,
  sendButton,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  draftKey: string;
  /** Lines whose item is Sold Out now: they must be removed before sending. */
  unavailable: ReadonlySet<string>;
  error: RpcErrorKey | null;
  onEdit: () => void;
  sendButton: ReactNode;
}) {
  const { t } = useTranslation(['ordering', 'rpc']);
  const draft = useDraft(draftKey);
  const update = useCartStore((state) => state.update);
  const change = (edit: Parameters<typeof update>[1]) => {
    onEdit();
    update(draftKey, edit);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="auto" className="gap-3">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{t('ordering:reviewDescription')}</SheetDescription>
        </SheetHeader>
        {draft.lines.length === 0 ? (
          <p className="py-6 text-center text-fg-muted">{t('ordering:reviewEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {draft.lines.map((line) => {
              const soldOut = unavailable.has(line.key);
              const noteId = `note-${line.key}`;
              return (
                <li key={line.key} className="space-y-2 py-3">
                  <div className="flex items-center gap-3">
                    <p className="min-w-0 flex-1 font-medium">{line.name}</p>
                    <QtyStepper
                      value={line.quantity}
                      itemName={line.name}
                      onChange={(quantity) => {
                        change((d) => setQuantity(d, line.key, quantity));
                      }}
                      onRemove={() => {
                        change((d) => removeLine(d, line.key));
                      }}
                    />
                  </div>
                  {soldOut && (
                    <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
                      <CircleAlert aria-hidden className="size-4" />
                      {t('ordering:soldOutInCart')}
                    </p>
                  )}
                  <label htmlFor={noteId} className="sr-only">
                    {t('ordering:noteFor', { name: line.name })}
                  </label>
                  <Input
                    id={noteId}
                    value={line.notes}
                    maxLength={MAX_NOTES}
                    placeholder={t('ordering:notePlaceholder')}
                    onChange={(event) => {
                      const notes = event.target.value;
                      change((d) => setNotes(d, line.key, notes));
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md bg-danger-bg p-3 text-danger"
          >
            <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
            {t(error)}
          </p>
        )}
        <SheetFooter className="[&>button]:w-full">{sendButton}</SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
