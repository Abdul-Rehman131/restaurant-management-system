import { zodResolver } from '@hookform/resolvers/zod';
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
  SkeletonList,
  StatusBadge,
  toast,
} from '@rms/ui';
import { useQuery } from '@tanstack/react-query';
import { Archive, ArchiveRestore, LayoutGrid, Pencil, Plus, UsersRound } from 'lucide-react';
import { useCallback, useId, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ErrorLine, ReasonDialog } from '../../dialogs/ReasonDialog';
import { useConnection } from '../../shell/connection-context';
import { adminKeys, adminRpc, tablesQuery } from './data';
import { parseWhole, tableFormSchema, type TableForm } from './forms';
import { useAdminAction } from './action';
import { PageHeader, StateBadge, TextField } from './ui';

type Table = rpc.AdminTable;

function TableDialog({
  table,
  sections,
  onClose,
}: {
  table: Table | null;
  sections: string[];
  onClose: () => void;
}) {
  const { t } = useTranslation(['admin', 'rpc']);
  const { canSend } = useConnection();
  const listId = useId();
  const form = useForm<TableForm>({
    resolver: zodResolver(tableFormSchema),
    defaultValues: {
      number: table ? String(table.number) : '',
      capacity: table ? String(table.capacity) : '4',
      section: table?.section ?? sections[0] ?? '',
    },
  });
  const save = useAdminAction(
    adminRpc.saveTable,
    adminKeys.tables,
    useCallback(
      (result: { created: boolean; table: Table }) => {
        toast.success(
          result.created
            ? t('admin:tables.created', { number: result.table.number })
            : t('admin:tables.saved', { number: result.table.number }),
        );
        onClose();
      },
      [t, onClose],
    ),
  );
  const { register, handleSubmit, formState } = form;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            void handleSubmit((values) =>
              save.run(table?.id ?? null, {
                number: parseWhole(values.number) ?? 0,
                capacity: parseWhole(values.capacity) ?? 0,
                section: values.section.trim(),
              }),
            )(event);
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {table
                ? t('admin:tables.editTitle', { number: table.number })
                : t('admin:tables.newTitle')}
            </DialogTitle>
            <DialogDescription>{t('admin:tables.formBody')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={t('admin:tables.number')}
              inputMode="numeric"
              autoComplete="off"
              error={formState.errors.number}
              {...register('number')}
            />
            <TextField
              label={t('admin:tables.capacity')}
              inputMode="numeric"
              autoComplete="off"
              error={formState.errors.capacity}
              {...register('capacity')}
            />
          </div>
          <TextField
            label={t('admin:tables.section')}
            autoComplete="off"
            list={listId}
            hint={t('admin:tables.sectionHint')}
            error={formState.errors.section}
            {...register('section')}
          />
          <datalist id={listId}>
            {sections.map((section) => (
              <option key={section} value={section} />
            ))}
          </datalist>
          <ErrorLine error={save.error} />
          <DialogFooter>
            <Button type="submit" loading={save.pending} disabled={!canSend}>
              {t('admin:save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Tables (M3): the grid by section with the live status (table broadcast), create, edit
 * (number unique, seats, section), archive (refused while an order is open, BR-05) and
 * restore. The status itself changes only with orders (G13).
 */
export function TablesScreen() {
  const { t } = useTranslation(['admin', 'rpc']);
  const { canSend } = useConnection();
  const tables = useQuery(tablesQuery);
  const [editing, setEditing] = useState<Table | 'new' | null>(null);
  const [archiving, setArchiving] = useState<Table | null>(null);
  const archive = useAdminAction(adminRpc.setTableActive, adminKeys.tables);
  const restore = useAdminAction(adminRpc.setTableActive, adminKeys.tables);

  const active = useMemo(() => (tables.data ?? []).filter((x) => x.is_active), [tables.data]);
  const archived = useMemo(() => (tables.data ?? []).filter((x) => !x.is_active), [tables.data]);
  const sections = useMemo(() => [...new Set(active.map((x) => x.section))].sort(), [active]);
  const close = useCallback(() => {
    setEditing(null);
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('admin:tables.title')}
        description={t('admin:tables.description')}
        actions={
          <Button
            disabled={!canSend}
            onClick={() => {
              setEditing('new');
            }}
          >
            <Plus aria-hidden />
            {t('admin:tables.new')}
          </Button>
        }
      />
      <ErrorLine error={restore.error} />
      {tables.isPending ? (
        <SkeletonList rows={6} />
      ) : tables.isError ? (
        <ErrorState
          title={t('admin:loadFailed')}
          description={t('admin:loadFailedBody')}
          retryLabel={t('admin:retry')}
          onRetry={() => void tables.refetch()}
        />
      ) : active.length === 0 ? (
        <EmptyState icon={LayoutGrid} title={t('admin:tables.empty')} />
      ) : (
        sections.map((section) => (
          <section key={section} aria-label={section} className="space-y-3">
            <h2 className="text-lg font-semibold">{section}</h2>
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
              {active
                .filter((x) => x.section === section)
                .map((table) => (
                  <li
                    key={table.id}
                    data-table={table.number}
                    className="space-y-3 rounded-lg border border-border bg-surface p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-2xl font-semibold tabular-nums">
                        {t('admin:tables.tableNumber', { number: table.number })}
                      </p>
                      <span className="flex items-center gap-1 text-sm text-fg-muted">
                        <UsersRound aria-hidden className="size-4" />
                        <span className="sr-only">{t('admin:tables.capacity')}</span>
                        {table.capacity}
                      </span>
                    </div>
                    <StatusBadge kind="table" status={table.status} />
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t('admin:tables.edit', { number: table.number })}
                        disabled={!canSend}
                        onClick={() => {
                          setEditing(table);
                        }}
                      >
                        <Pencil aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-danger"
                        aria-label={t('admin:tables.archive', { number: table.number })}
                        disabled={!canSend}
                        onClick={() => {
                          archive.clearError();
                          setArchiving(table);
                        }}
                      >
                        <Archive aria-hidden />
                      </Button>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ))
      )}
      {archived.length > 0 && (
        <section aria-labelledby="tables-archived" className="space-y-3">
          <h2 id="tables-archived" className="text-lg font-semibold">
            {t('admin:tables.archived')}
          </h2>
          <ul className="rounded-lg border border-border bg-surface">
            {archived.map((table) => (
              <li
                key={table.id}
                className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
              >
                <p className="flex-1 font-medium">
                  {t('admin:tables.tableNumber', { number: table.number })} · {table.section}
                </p>
                <StateBadge archived />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canSend || restore.pending}
                  onClick={() => void restore.run(table.id, true, '')}
                >
                  <ArchiveRestore aria-hidden />
                  {t('admin:restore')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {editing !== null && (
        <TableDialog
          key={editing === 'new' ? 'new' : editing.id}
          table={editing === 'new' ? null : editing}
          sections={sections}
          onClose={close}
        />
      )}
      <ReasonDialog
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        title={t('admin:tables.archiveTitle', { number: archiving?.number ?? 0 })}
        description={t('admin:tables.archiveBody')}
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
