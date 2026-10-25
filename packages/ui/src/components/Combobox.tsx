import { Check, ChevronsUpDown } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../lib/cn';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from './Command';
import { fieldClasses } from './Input';
import { Popover, PopoverContent, PopoverTrigger } from './Popover';

export interface ComboboxOption {
  value: string;
  label: string;
}

export interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (value: string | null) => void;
  /** Shown when nothing is chosen. */
  placeholder: string;
  /** Defaults to the ui namespace's "Search" and "No results". */
  searchPlaceholder?: string;
  emptyText?: string;
  id?: string;
  disabled?: boolean;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  className?: string;
}

/** A Select with search (Popover + Command), for long lists such as menu items. */
export function Combobox({
  options,
  value,
  onValueChange,
  placeholder,
  searchPlaceholder,
  emptyText,
  className,
  ...triggerProps
}: ComboboxProps) {
  const { t } = useTranslation('ui');
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        role="combobox"
        aria-expanded={open}
        className={cn(
          fieldClasses,
          'flex h-control-md items-center justify-between gap-2 text-start',
          !selected && 'text-fg-muted',
          className,
        )}
        {...triggerProps}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronsUpDown aria-hidden className="size-5 shrink-0 text-fg-muted" />
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
        <Command label={searchPlaceholder ?? t('combobox.search')}>
          <CommandInput placeholder={searchPlaceholder ?? t('combobox.search')} />
          <CommandList>
            <CommandEmpty>{emptyText ?? t('combobox.empty')}</CommandEmpty>
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={option.label}
                onSelect={() => {
                  onValueChange(option.value === value ? null : option.value);
                  setOpen(false);
                }}
              >
                <Check
                  aria-hidden
                  className={cn('text-brand', option.value === value ? 'opacity-100' : 'opacity-0')}
                  strokeWidth={3}
                />
                {option.label}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
