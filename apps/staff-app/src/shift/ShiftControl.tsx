import './i18n';

import {
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@rms/ui';
import { Play, Square, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { beginShift, useWakeText } from './lifecycle';
import { useShiftStore, type ShiftRole } from './store';

/**
 * Header control: "Start shift", then a clear "Shift on" button (its menu says whether the
 * screen stays awake and has End shift) next to the visible mute toggle. Labels of the mute
 * toggle come from the role (what it silences differs).
 */
export function ShiftControl({
  shift,
  muted,
  onMutedChange,
  muteLabel,
  unmuteLabel,
  className,
}: {
  /** Whose shift: waiter, kitchen or cashier. */
  shift: ShiftRole;
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  muteLabel: string;
  unmuteLabel: string;
  className?: string;
}) {
  const { t } = useTranslation('shift');
  const on = useShiftStore((state) => state.on[shift]);
  const wake = useShiftStore((state) => state.wake);
  const wakeText = useWakeText();

  if (!on) {
    return (
      <Button
        variant="outline"
        className={cn('min-h-11', className)}
        onClick={() => {
          beginShift(shift, muted, t('started'), muted ? t('startedMuted') : t('startedSound'));
        }}
      >
        <Play aria-hidden />
        {t('start')}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            aria-label={t('menu')}
            className={cn('min-h-11 border-success text-success', className)}
          >
            <span aria-hidden className="size-2.5 rounded-full bg-success" />
            <span aria-hidden>{t('on')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-72">
          <DropdownMenuLabel
            className={cn('font-normal', wake && wake !== 'on' ? 'text-warning' : 'text-fg-muted')}
          >
            {wakeText}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              useShiftStore.getState().setOn(shift, false);
              toast(t('ended'));
            }}
          >
            <Square aria-hidden />
            {t('end')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        className={cn('min-h-11', muted && 'text-danger')}
        aria-pressed={muted}
        aria-label={muted ? unmuteLabel : muteLabel}
        onClick={() => {
          onMutedChange(!muted);
        }}
      >
        {muted ? <VolumeX aria-hidden /> : <Volume2 aria-hidden />}
      </Button>
    </div>
  );
}
