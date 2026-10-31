import type { rpc } from '@rms/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  SkeletonList,
  toast,
} from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  FolderOpen,
  Pencil,
  Plus,
} from 'lucide-react';
import { useCallback, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ErrorLine, ReasonDialog } from '../../dialogs/ReasonDialog';
import { useConnection } from '../../shell/connection-context';
import { adminKeys, adminRpc, menuQuery } from './data';
import { moved } from './forms';
import { useAdminAction } from './action';
import { PageHeader, StateBadge } from './ui';

type Category = rpc.AdminCategory;

/** Create or rename: one name, checked again by the server (unique, 1 to 60). */
function NameDialog({
  category,
  open,
  onOpenChange,
}: {
  category: Category | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation(['admin', 'rpc']);
  const { canSend } = useConnection();
  const id = useId();
  const [name, setName] = useState(category?.name ?? '');
  const save = useAdminAction(
    adminRpc.saveCategory,
    adminKeys.menu,
    useCallback(
      (result: { created: boolean; category: Category }) => {
        toast.success(
          result.created
            ? t('admin:categories.created', { name: result.category.name })
            : t('admin:categories.renamed', { name: result.category.name }),
        );
        onOpenChange(false);
      },
      [t, onOpenChange],
    ),
  );
  const tooLong = name.trim().length > 60;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save.run(category?.id ?? null, name.trim());
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {category ? t('admin:categories.renameTitle') : t('admin:categories.newTitle')}
            </DialogTitle>
            <DialogDescription>{t('admin:categories.nameBody')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={id}>{t('admin:categories.name')}</Label>
            <Input
              id={id}
              value={name}
              autoComplete="off"
              aria-invalid={tooLong || undefined}
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
          </div>
          <ErrorLine error={save.error} />
          <DialogFooter>
            <Button
              type="submit"
              loading={save.pending}
              disabled={!canSend || name.trim() === '' || tooLong}
            >
              {t('admin:save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Categories (M2): sort order (up and down), create, rename, archive (only when no active item
 * is left in it, so no item is hidden by accident) and restore. Never deleted (BR-14).
 */
export function CategoriesScreen() {
  const { t } = useTranslation(['admin', 'rpc']);
  const { canSend } = useConnection();
  const menu = useQuery(menuQuery);
  const [editing, setEditing] = useState<Category | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Category | null>(null);

  const categories = menu.data?.categories ?? [];
  const active = categories.filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order);
  const archived = categories.filter((c) => !c.is_active);
  const order = active.map((c) => c.id);

  const reorder = useAdminAction(adminRpc.reorderCategories, adminKeys.menu);
  const archive = useAdminAction(adminRpc.setCategoryActive, adminKeys.menu);
  const restore = useAdminAction(adminRpc.setCategoryActive, adminKeys.menu);
  const busy = reorder.pending || archive.pending || restore.pending;

  const row = (category: Category, index: number) => (
    <li
      key={category.id}
      data-row={category.id}
      className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium">{category.name}</p>
        <p className="text-sm text-fg-muted">
          {t('admin:categories.items', { count: category.active_items })}
        </p>
      </div>
      <StateBadge archived={!category.is_active} />
      <div className="flex flex-wrap gap-1">
        {category.is_active ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('admin:moveUp', { name: category.name })}
              disabled={!canSend || busy || index === 0}
              onClick={() => void reorder.run(moved(order, category.id, -1))}
            >
              <ArrowUp aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('admin:moveDown', { name: category.name })}
              disabled={!canSend || busy || index === order.length - 1}
              onClick={() => void reorder.run(moved(order, category.id, 1))}
            >
              <ArrowDown aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t('admin:edit', { name: category.name })}
              disabled={!canSend}
              onClick={() => {
                setEditing(category);
              }}
            >
              <Pencil aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-danger"
              aria-label={t('admin:archiveNamed', { name: category.name })}
              title={category.active_items > 0 ? t('admin:categories.archiveHasItems') : undefined}
              disabled={!canSend || busy || category.active_items > 0}
              onClick={() => {
                archive.clearError();
                setArchiving(category);
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
            onClick={() => void restore.run(category.id, true, '')}
          >
            <ArchiveRestore aria-hidden />
            {t('admin:restore')}
          </Button>
        )}
      </div>
    </li>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin:categories.title')}
        description={t('admin:categories.description')}
        actions={
          <Button
            disabled={!canSend}
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus aria-hidden />
            {t('admin:categories.new')}
          </Button>
        }
      />
      <ErrorLine error={reorder.error ?? restore.error} />
      {menu.isPending ? (
        <SkeletonList rows={6} />
      ) : menu.isError ? (
        <ErrorState
          title={t('admin:loadFailed')}
          description={t('admin:loadFailedBody')}
          retryLabel={t('admin:retry')}
          onRetry={() => void menu.refetch()}
        />
      ) : active.length === 0 && archived.length === 0 ? (
        <EmptyState icon={FolderOpen} title={t('admin:categories.empty')} />
      ) : (
        <>
          <section aria-labelledby="categories-active" className="space-y-2">
            <h2 id="categories-active" className="text-lg font-semibold">
              {t('admin:categories.inUse')}
            </h2>
            <ol className="rounded-lg border border-border bg-surface">
              {active.map((category, index) => row(category, index))}
            </ol>
            <p className="text-sm text-fg-muted">{t('admin:categories.archiveHint')}</p>
          </section>
          {archived.length > 0 && (
            <section aria-labelledby="categories-archived" className="space-y-2">
              <h2 id="categories-archived" className="text-lg font-semibold">
                {t('admin:categories.archived')}
              </h2>
              <ul className="rounded-lg border border-border bg-surface">
                {archived.map((category, index) => row(category, index))}
              </ul>
            </section>
          )}
        </>
      )}
      {editing !== null && (
        <NameDialog
          key={editing === 'new' ? 'new' : editing.id}
          category={editing === 'new' ? null : editing}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
        />
      )}
      <ReasonDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        title={t('admin:categories.archiveTitle', { name: archiving?.name ?? '' })}
        description={t('admin:categories.archiveBody')}
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
