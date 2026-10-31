import {
  Button,
  EmptyState,
  Input,
  SkeletonList,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
} from '@rms/ui';
import { ChevronLeft, ChevronRight, Search, type LucideIcon } from 'lucide-react';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { SelectField } from '../../dialogs/ReasonDialog';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Right-aligned (end) numbers and money. */
  numeric?: boolean;
  className?: string;
}

export interface Filter {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}

/**
 * DataTable (plan 4.4): instant search, filters and paging over rows already loaded (one
 * restaurant: a few hundred rows at most), a table from md up and cards on phones (plan 4.5).
 * The first column is the card's title; actions sit in the last column / the card's footer.
 */
export function DataTable<T>({
  rows,
  rowId,
  columns,
  actions,
  searchLabel,
  matches,
  filters = [],
  loading,
  empty,
  emptyIcon,
  pageSize = 20,
  caption,
}: {
  rows: T[] | undefined;
  rowId: (row: T) => string;
  columns: Column<T>[];
  actions?: (row: T) => ReactNode;
  searchLabel: string;
  matches: (row: T, query: string) => boolean;
  filters?: Filter[];
  loading: boolean;
  empty: string;
  emptyIcon: LucideIcon;
  pageSize?: number;
  /** The table's accessible name. */
  caption: string;
}) {
  const { t } = useTranslation(['admin']);
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const shown = useMemo(() => {
    const words = query.trim().toLocaleLowerCase();
    return (rows ?? []).filter((row) => words === '' || matches(row, words));
  }, [rows, query, matches]);
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const current = Math.min(page, pages - 1);
  const visible = shown.slice(current * pageSize, (current + 1) * pageSize);
  const [title, ...rest] = columns;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-56 flex-1 gap-1.5">
          <label htmlFor={searchId} className="sr-only">
            {searchLabel}
          </label>
          <div className="relative">
            <Search
              aria-hidden
              className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-fg-muted"
            />
            <Input
              id={searchId}
              type="search"
              value={query}
              placeholder={searchLabel}
              className="ps-10"
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>
        {filters.map((filter) => (
          <div key={filter.label} className="w-full sm:w-48">
            <SelectField
              label={filter.label}
              value={filter.value}
              onChange={(value) => {
                filter.onChange(value);
                setPage(0);
              }}
            >
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectField>
          </div>
        ))}
      </div>

      {loading ? (
        <SkeletonList rows={6} />
      ) : shown.length === 0 ? (
        <EmptyState icon={emptyIcon} title={empty} />
      ) : (
        <>
          {/* md and up: a table */}
          <div className="hidden rounded-lg border border-border bg-surface md:block">
            <Table aria-label={caption}>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead
                      key={column.key}
                      className={cn(column.numeric && 'text-end', column.className)}
                    >
                      {column.header}
                    </TableHead>
                  ))}
                  {actions && (
                    <TableHead className="text-end">
                      <span className="sr-only">{t('admin:table.actions')}</span>
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((row) => (
                  <TableRow key={rowId(row)} data-row={rowId(row)}>
                    {columns.map((column) => (
                      <TableCell
                        key={column.key}
                        className={cn(column.numeric && 'text-end', column.className)}
                      >
                        {column.cell(row)}
                      </TableCell>
                    ))}
                    {actions && (
                      <TableCell className="text-end">
                        <div className="flex justify-end gap-1">{actions(row)}</div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* phones: cards */}
          <ul aria-label={caption} className="grid gap-3 md:hidden">
            {visible.map((row) => (
              <li
                key={rowId(row)}
                data-row={rowId(row)}
                className="space-y-3 rounded-lg border border-border bg-surface p-4"
              >
                {title && <div className="font-semibold">{title.cell(row)}</div>}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  {rest.map((column) => (
                    <div key={column.key} className="min-w-0">
                      <dt className="text-fg-muted">{column.header}</dt>
                      <dd className="min-w-0">{column.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
                {actions && <div className="flex flex-wrap gap-2">{actions(row)}</div>}
              </li>
            ))}
          </ul>

          {pages > 1 && (
            <nav
              aria-label={t('admin:table.pages')}
              className="flex items-center justify-between gap-3"
            >
              <p className="text-sm text-fg-muted" aria-live="polite">
                {t('admin:table.pageOf', { page: current + 1, pages, count: shown.length })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t('admin:table.previous')}
                  disabled={current === 0}
                  onClick={() => {
                    setPage(current - 1);
                  }}
                >
                  <ChevronLeft aria-hidden className="rtl:-scale-x-100" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={t('admin:table.next')}
                  disabled={current >= pages - 1}
                  onClick={() => {
                    setPage(current + 1);
                  }}
                >
                  <ChevronRight aria-hidden className="rtl:-scale-x-100" />
                </Button>
              </div>
            </nav>
          )}
        </>
      )}
    </div>
  );
}
