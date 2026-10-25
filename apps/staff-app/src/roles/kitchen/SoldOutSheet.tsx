import {
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SkeletonList,
  Switch,
  cn,
} from '@rms/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRpcAction } from '../../lib/useRpcAction';
import { useConnection } from '../../shell/connection-context';
import { kitchenKeys, kitchenRpc, menuQuery, type MenuAvailabilityItem } from './data';

const normalize = (text: string) => text.toLocaleLowerCase().normalize('NFKD');

function ItemRow({ item }: { item: MenuAvailabilityItem }) {
  const { t } = useTranslation(['kitchen', 'rpc']);
  const { canSend } = useConnection();
  const queryClient = useQueryClient();
  const toggle = useRpcAction(
    kitchenRpc.setAvailability,
    useCallback(() => queryClient.refetchQueries({ queryKey: kitchenKeys.menu }), [queryClient]),
  );
  const switchId = `available-${item.menu_item_id}`;

  return (
    <li className="py-2">
      <div className="flex min-h-14 items-center gap-3">
        <label
          htmlFor={switchId}
          className={cn(
            'min-w-0 flex-1 text-xl',
            !item.is_available && 'text-fg-muted line-through',
          )}
        >
          {item.name}
        </label>
        <span
          className={cn(
            'w-24 text-end text-sm font-semibold',
            item.is_available ? 'text-success' : 'text-danger',
          )}
        >
          {item.is_available ? t('kitchen:available') : t('kitchen:soldOutLabel')}
        </span>
        <Switch
          id={switchId}
          checked={item.is_available}
          disabled={!canSend || toggle.pending}
          aria-busy={toggle.pending || undefined}
          onCheckedChange={(checked) => void toggle.run(item.menu_item_id, checked)}
        />
      </div>
      {toggle.error && (
        <p role="alert" className="flex items-start gap-2 text-danger">
          <CircleAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
          {t(toggle.error)}
        </p>
      )}
    </li>
  );
}

/**
 * The Sold Out sheet (M6, BR-13): search the active menu (get_menu_availability, no prices)
 * and switch items off and on. The switch shows the server's value only after it confirms;
 * every ordering screen updates live through staff:menu.
 */
export function SoldOutSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['kitchen', 'rpc']);
  const menu = useQuery({ ...menuQuery, enabled: open });
  const [query, setQuery] = useState('');

  const groups = useMemo(() => {
    const words = normalize(query.trim());
    const items = (menu.data ?? []).filter(
      (item) => !words || normalize(`${item.name} ${item.category_name}`).includes(words),
    );
    const byCategory = new Map<string, { name: string; items: MenuAvailabilityItem[] }>();
    for (const item of items) {
      const group = byCategory.get(item.category_id) ?? { name: item.category_name, items: [] };
      group.items.push(item);
      byCategory.set(item.category_id, group);
    }
    return [...byCategory.entries()];
  }, [menu.data, query]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="end" className="gap-3 md:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t('kitchen:soldOutTitle')}</SheetTitle>
          <SheetDescription>{t('kitchen:soldOutDescription')}</SheetDescription>
        </SheetHeader>
        <label className="relative block">
          <span className="sr-only">{t('kitchen:searchLabel')}</span>
          <Search
            aria-hidden
            className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted"
          />
          <Input
            type="search"
            value={query}
            placeholder={t('kitchen:searchPlaceholder')}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            className="ps-10"
          />
        </label>
        {menu.isPending ? (
          <SkeletonList rows={8} />
        ) : menu.isError ? (
          <p role="alert" className="text-danger">
            {t('kitchen:menuLoadFailed')}
          </p>
        ) : groups.length === 0 ? (
          <p className="py-6 text-center text-fg-muted">{t('kitchen:noResults', { query })}</p>
        ) : (
          groups.map(([id, group]) => (
            <section key={id} aria-labelledby={`category-${id}`}>
              <h3 id={`category-${id}`} className="text-sm font-semibold text-fg-muted uppercase">
                {group.name}
              </h3>
              <ul className="divide-y divide-border">
                {group.items.map((item) => (
                  <ItemRow key={item.menu_item_id} item={item} />
                ))}
              </ul>
            </section>
          ))
        )}
      </SheetContent>
    </Sheet>
  );
}
