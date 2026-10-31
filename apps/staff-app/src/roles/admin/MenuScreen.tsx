import type { rpc } from '@rms/shared';
import { Button, ErrorState, MoneyText, toast } from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Ban,
  CircleCheck,
  Pencil,
  Plus,
  UtensilsCrossed,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { ReasonDialog } from '../../dialogs/ReasonDialog';
import { useConnection } from '../../shell/connection-context';
import { adminKeys, adminRpc, menuQuery } from './data';
import { DataTable, type Column } from './DataTable';
import { moved } from './forms';
import { adminPaths } from './paths';
import { useAdminAction } from './action';
import { PageHeader, Photo, StateBadge } from './ui';

type Item = rpc.AdminMenuItem;
type Status = 'active' | 'archived' | 'soldOut' | 'all';
const ALL = 'all';
const statuses: Status[] = ['active', 'soldOut', 'archived', 'all'];

/**
 * Menu (M2): every item with its photo, category, price and cost price (Admin only), searched
 * and filtered; edit, Sold Out, archive and restore (BR-13, BR-14). With one category chosen
 * the items show in their order and can be moved up or down. Changes reach the ordering
 * screens live (menu broadcast).
 */
export function MenuScreen() {
  const { t } = useTranslation(['admin', 'rpc']);
  const { canSend } = useConnection();
  const menu = useQuery(menuQuery);
  const [category, setCategory] = useState<string>(ALL);
  const [status, setStatus] = useState<Status>('active');
  const [archiving, setArchiving] = useState<Item | null>(null);

  const categories = useMemo(() => menu.data?.categories ?? [], [menu.data]);
  const categoryName = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name] as const)),
    [categories],
  );

  const rows = useMemo(() => {
    const items = (menu.data?.items ?? []).filter((item) => {
      if (category !== ALL && item.category_id !== category) return false;
      if (status === 'active') return item.is_active;
      if (status === 'archived') return !item.is_active;
      if (status === 'soldOut') return item.is_active && !item.is_available;
      return true;
    });
    return category === ALL
      ? items
      : [...items].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [menu.data, category, status]);

  const ordering = category !== ALL && status === 'active';
  const categoryOrder = rows.map((row) => row.id);

  const archive = useAdminAction(adminRpc.setMenuItemActive, adminKeys.menu);
  const restore = useAdminAction(
    adminRpc.setMenuItemActive,
    adminKeys.menu,
    useCallback(() => {
      toast.success(t('admin:menu.restored'));
    }, [t]),
  );
  const availability = useAdminAction(adminRpc.setItemAvailability, adminKeys.menu);
  const reorder = useAdminAction(adminRpc.reorderMenuItems, adminKeys.menu);
  const busy = archive.pending || restore.pending || availability.pending || reorder.pending;
  const error = restore.error ?? availability.error ?? reorder.error;

  const columns: Column<Item>[] = [
    {
      key: 'name',
      header: t('admin:menu.item'),
      cell: (item) => (
        <span className="flex items-center gap-3">
          <Photo path={item.image_path} alt="" className="size-10" />
          <span className="min-w-0">
            <Link
              to={adminPaths.item(item.id)}
              className="font-medium underline-offset-4 hover:underline"
            >
              {item.name}
            </Link>
            {!item.needs_kitchen && (
              <span className="block text-sm text-fg-muted">{t('admin:menu.noKitchen')}</span>
            )}
          </span>
        </span>
      ),
    },
    {
      key: 'category',
      header: t('admin:menu.category'),
      cell: (item) => categoryName.get(item.category_id) ?? '',
    },
    {
      key: 'price',
      header: t('admin:menu.price'),
      numeric: true,
      cell: (item) => <MoneyText amount={item.price} />,
    },
    {
      key: 'cost',
      header: t('admin:menu.cost'),
      numeric: true,
      cell: (item) => <MoneyText amount={item.cost_price} className="text-fg-muted" />,
    },
    {
      key: 'state',
      header: t('admin:menu.state'),
      cell: (item) => <StateBadge archived={!item.is_active} soldOut={!item.is_available} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin:menu.title')}
        description={t('admin:menu.description')}
        actions={
          canSend ? (
            <Button asChild>
              <Link to={adminPaths.newItem}>
                <Plus aria-hidden />
                {t('admin:menu.new')}
              </Link>
            </Button>
          ) : (
            <Button disabled>
              <Plus aria-hidden />
              {t('admin:menu.new')}
            </Button>
          )
        }
      />
      {error && (
        <p role="alert" className="rounded-md bg-danger-bg p-3 text-danger">
          {t(error)}
        </p>
      )}
      {menu.isError ? (
        <ErrorState
          title={t('admin:loadFailed')}
          description={t('admin:loadFailedBody')}
          retryLabel={t('admin:retry')}
          onRetry={() => void menu.refetch()}
        />
      ) : (
        <>
          <DataTable
            rows={rows}
            rowId={(item) => item.id}
            columns={columns}
            loading={menu.isPending}
            caption={t('admin:menu.title')}
            searchLabel={t('admin:menu.search')}
            matches={(item, query) =>
              `${item.name} ${item.description ?? ''}`.toLocaleLowerCase().includes(query)
            }
            empty={t('admin:menu.empty')}
            emptyIcon={UtensilsCrossed}
            pageSize={ordering ? 200 : 20}
            filters={[
              {
                label: t('admin:menu.category'),
                value: category,
                onChange: setCategory,
                options: [
                  { value: ALL, label: t('admin:menu.allCategories') },
                  ...categories
                    .filter((c) => c.is_active)
                    .map((c) => ({ value: c.id, label: c.name })),
                ],
              },
              {
                label: t('admin:menu.state'),
                value: status,
                onChange: (value) => {
                  setStatus(value as Status);
                },
                options: statuses.map((value) => ({ value, label: t(`admin:state.${value}`) })),
              },
            ]}
            actions={(item) => (
              <>
                {ordering && (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('admin:moveUp', { name: item.name })}
                      disabled={!canSend || busy || categoryOrder[0] === item.id}
                      onClick={() => void reorder.run(category, moved(categoryOrder, item.id, -1))}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('admin:moveDown', { name: item.name })}
                      disabled={!canSend || busy || categoryOrder.at(-1) === item.id}
                      onClick={() => void reorder.run(category, moved(categoryOrder, item.id, 1))}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                  </>
                )}
                {item.is_active ? (
                  <>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('admin:edit', { name: item.name })}
                      asChild
                    >
                      <Link to={adminPaths.item(item.id)}>
                        <Pencil aria-hidden />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={
                        item.is_available
                          ? t('admin:menu.markSoldOut', { name: item.name })
                          : t('admin:menu.markAvailable', { name: item.name })
                      }
                      disabled={!canSend || busy}
                      onClick={() => void availability.run(item.id, !item.is_available)}
                    >
                      {item.is_available ? <Ban aria-hidden /> : <CircleCheck aria-hidden />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-danger"
                      aria-label={t('admin:archiveNamed', { name: item.name })}
                      disabled={!canSend || busy}
                      onClick={() => {
                        archive.clearError();
                        setArchiving(item);
                      }}
                    >
                      <Archive aria-hidden />
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!canSend || busy}
                    onClick={() => void restore.run(item.id, true, '')}
                  >
                    <ArchiveRestore aria-hidden />
                    {t('admin:restore')}
                  </Button>
                )}
              </>
            )}
          />
          {category === ALL && status === 'active' && (
            <p className="text-sm text-fg-muted">{t('admin:menu.orderHint')}</p>
          )}
        </>
      )}
      <ReasonDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        title={t('admin:menu.archiveTitle', { name: archiving?.name ?? '' })}
        description={t('admin:menu.archiveBody')}
        confirmLabel={t('admin:archive')}
        labels={{
          reason: t('admin:reason'),
          placeholder: t('admin:reasonPlaceholder'),
          keep: t('admin:keep'),
        }}
        pending={archive.pending}
        error={archive.error}
        onConfirm={(reason) =>
          archiving ? archive.run(archiving.id, false, reason) : Promise.resolve(false)
        }
      />
    </div>
  );
}
