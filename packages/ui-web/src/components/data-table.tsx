import {
  type ColumnVisibilityState,
  type OnChangeFn,
  type PaginationState,
  type RowData,
  type RowSelectionState,
  type SortingState,
  useTable,
} from '@tanstack/react-table';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
} from 'lucide-react';
import * as React from 'react';
import { cn } from '../lib/cn.js';
import { Button } from './button.js';
import { EmptyState, ErrorState, Skeleton } from './feedback.js';
import {
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './overlays.js';

import {
  type DataTableColumnDef,
  type DataTableColumnMeta,
  dataTableFeatures,
} from './data-table-features.js';

export interface DataTableProps<TData extends RowData> {
  /** Accessible name of the grid. */
  'aria-label': string;
  /** Must be referentially stable (module scope or useMemo). */
  columns: DataTableColumnDef<TData>[];
  data: TData[];
  getRowId: (row: TData, index: number) => string;

  /**
   * `client`: sorting/pagination happen in the browser over `data`.
   * `server`: `data` is one already-sorted page; supply `rowCount`, `pagination`, `sorting` and handlers.
   */
  mode?: 'client' | 'server';
  rowCount?: number;
  pagination?: PaginationState;
  onPaginationChange?: OnChangeFn<PaginationState>;
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;
  pageSizeOptions?: number[];
  /** Hide the pagination footer (small, fixed lists). */
  hidePagination?: boolean;

  enableRowSelection?: boolean;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Rendered in the toolbar while rows are selected. Receives the selected originals. */
  bulkActions?: (selected: TData[]) => React.ReactNode;

  initialColumnVisibility?: ColumnVisibilityState;
  enableColumnVisibility?: boolean;

  onRowActivate?: (row: TData) => void;
  /** Left side of the toolbar (search, filters). */
  toolbar?: React.ReactNode;

  isLoading?: boolean;
  /** Background refetch with existing rows visible. */
  isFetching?: boolean;
  error?: string | null;
  onRetry?: () => void;
  emptyTitle?: string;
  emptyDescription?: React.ReactNode;
  className?: string;
}

const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];
const SELECT_COLUMN_ID = '__select';

function useControllable<T>(value: T | undefined, onChange: OnChangeFn<T> | undefined, initial: T) {
  const [internal, setInternal] = React.useState<T>(initial);
  const isControlled = value !== undefined;
  const state = isControlled ? value : internal;
  const setState: OnChangeFn<T> = React.useCallback(
    (updater) => {
      if (onChange) onChange(updater);
      if (!isControlled) setInternal(updater);
    },
    [isControlled, onChange],
  );
  return [state, setState] as const;
}

function columnLabel(column: {
  id: string;
  columnDef: { header?: unknown; meta?: unknown };
}): string {
  const meta = column.columnDef.meta as DataTableColumnMeta | undefined;
  if (meta?.label) return meta.label;
  return typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id;
}

/**
 * Enterprise data table: client or server pagination/sorting, row selection with bulk actions,
 * column visibility and resizing, sticky header, keyboard row navigation and
 * loading / empty / error states. Density follows the global `[data-density]` setting.
 */
export function DataTable<TData extends RowData>(props: DataTableProps<TData>) {
  const {
    columns: userColumns,
    data,
    getRowId,
    mode = 'client',
    rowCount,
    pageSizeOptions = DEFAULT_PAGE_SIZES,
    hidePagination = false,
    enableRowSelection = false,
    bulkActions,
    enableColumnVisibility = true,
    onRowActivate,
    toolbar,
    isLoading = false,
    isFetching = false,
    error,
    onRetry,
    emptyTitle = 'No records found',
    emptyDescription,
    className,
  } = props;

  const [pagination, setPagination] = useControllable(props.pagination, props.onPaginationChange, {
    pageIndex: 0,
    pageSize: pageSizeOptions[0] ?? 25,
  });
  const [sorting, setSorting] = useControllable<SortingState>(
    props.sorting,
    props.onSortingChange,
    [],
  );
  const [rowSelection, setRowSelection] = useControllable<RowSelectionState>(
    props.rowSelection,
    props.onRowSelectionChange,
    {},
  );
  const [columnVisibility, setColumnVisibility] = React.useState<ColumnVisibilityState>(
    props.initialColumnVisibility ?? {},
  );

  const columns = React.useMemo<DataTableColumnDef<TData>[]>(() => {
    if (!enableRowSelection) return userColumns;
    const select: DataTableColumnDef<TData> = {
      id: SELECT_COLUMN_ID,
      size: 36,
      minSize: 36,
      enableSorting: false,
      enableHiding: false,
      enableResizing: false,
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all rows on this page"
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? 'indeterminate'
                : false
          }
          onCheckedChange={(v) => {
            table.toggleAllPageRowsSelected(v === true);
          }}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label="Select row"
          checked={row.getIsSelected()}
          onClick={(e) => {
            e.stopPropagation();
          }}
          onCheckedChange={(v) => {
            row.toggleSelected(v === true);
          }}
        />
      ),
    };
    return [select, ...userColumns];
  }, [enableRowSelection, userColumns]);

  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId,
    state: { pagination, sorting, rowSelection, columnVisibility },
    onPaginationChange: setPagination,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    onColumnVisibilityChange: setColumnVisibility,
    enableRowSelection,
    manualPagination: mode === 'server',
    manualSorting: mode === 'server',
    ...(mode === 'server' && rowCount !== undefined ? { rowCount } : {}),
    columnResizeMode: 'onChange',
    autoResetPageIndex: mode === 'client',
  });

  const rows = table.getRowModel().rows;
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const selectedOriginals = enableRowSelection
    ? table.getSelectedRowModel().rows.map((r) => r.original)
    : [];
  const totalRows = mode === 'server' ? (rowCount ?? 0) : data.length;
  const pageCount = Math.max(1, table.getPageCount());
  const firstRow = totalRows === 0 ? 0 : pagination.pageIndex * pagination.pageSize + 1;
  const lastRow = Math.min(totalRows, (pagination.pageIndex + 1) * pagination.pageSize);

  const bodyRef = React.useRef<HTMLTableSectionElement>(null);
  const onRowKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>, original: TData) => {
    const focusables = Array.from(
      bodyRef.current?.querySelectorAll<HTMLTableRowElement>('tr[data-row]') ?? [],
    );
    const index = focusables.indexOf(event.currentTarget);
    const move = (to: number) => {
      event.preventDefault();
      focusables[Math.max(0, Math.min(focusables.length - 1, to))]?.focus();
    };
    switch (event.key) {
      case 'ArrowDown':
        move(index + 1);
        break;
      case 'ArrowUp':
        move(index - 1);
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(focusables.length - 1);
        break;
      case 'Enter':
        if (onRowActivate) {
          event.preventDefault();
          onRowActivate(original);
        }
        break;
      case ' ':
        if (enableRowSelection) {
          event.preventDefault();
          const id = event.currentTarget.dataset.rowId;
          if (id) table.getRow(id).toggleSelected();
        }
        break;
    }
  };

  const showToolbar = Boolean(toolbar) || enableColumnVisibility || selectedOriginals.length > 0;

  return (
    <div
      data-slot="data-table"
      className={cn('flex min-w-0 flex-col rounded-lg border border-border bg-card', className)}
    >
      {showToolbar ? (
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-b border-border px-2 py-1.5">
          {selectedOriginals.length > 0 && bulkActions ? (
            <div className="flex items-center gap-2" role="region" aria-label="Bulk actions">
              <span className="text-sm font-medium tabular" aria-live="polite">
                {selectedOriginals.length} selected
              </span>
              {bulkActions(selectedOriginals)}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  table.resetRowSelection();
                }}
              >
                Clear
              </Button>
            </div>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-2">{toolbar}</div>
          )}
          <div className="ml-auto flex items-center gap-2">
            {isFetching && !isLoading ? (
              <span className="text-xs text-muted-foreground" aria-live="polite">
                Updating…
              </span>
            ) : null}
            {enableColumnVisibility ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" aria-label="Choose visible columns">
                    <Columns3 />
                    <span className="hidden sm:inline">Columns</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {table
                    .getAllLeafColumns()
                    .filter((c) => c.getCanHide())
                    .map((c) => (
                      <DropdownMenuCheckboxItem
                        key={c.id}
                        checked={c.getIsVisible()}
                        onCheckedChange={(v) => {
                          c.toggleVisibility(v);
                        }}
                        onSelect={(e) => {
                          e.preventDefault();
                        }}
                      >
                        {columnLabel(c)}
                      </DropdownMenuCheckboxItem>
                    ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="relative max-h-[70vh] min-h-0 overflow-auto">
        <table
          aria-label={props['aria-label']}
          aria-busy={isLoading || isFetching}
          aria-rowcount={totalRows}
          className="w-full border-separate border-spacing-0 text-base"
          style={{ minWidth: table.getTotalSize() }}
        >
          <thead className="sticky top-0 z-10 bg-subtle">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const meta: DataTableColumnMeta | undefined = header.column.columnDef.meta;
                  const sorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      colSpan={header.colSpan}
                      aria-sort={
                        sorted === 'asc'
                          ? 'ascending'
                          : sorted === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      style={{ width: header.getSize() }}
                      className={cn(
                        'group relative h-8 border-b border-border px-2 text-left text-sm font-medium whitespace-nowrap text-muted-foreground',
                        meta?.align === 'right' && 'text-right',
                        meta?.align === 'center' && 'text-center',
                      )}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            '-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 hover:bg-accent hover:text-foreground',
                            meta?.align === 'right' && 'flex-row-reverse',
                          )}
                        >
                          <table.FlexRender header={header} />
                          {sorted === 'asc' ? (
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          ) : (
                            <ArrowUpDown
                              className="size-3.5 opacity-0 group-hover:opacity-60"
                              aria-hidden="true"
                            />
                          )}
                        </button>
                      ) : (
                        <table.FlexRender header={header} />
                      )}
                      {header.column.getCanResize() ? (
                        <div
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize ${columnLabel(header.column)} column`}
                          onMouseDown={header.getResizeHandler()}
                          onTouchStart={header.getResizeHandler()}
                          onDoubleClick={() => {
                            header.column.resetSize();
                          }}
                          className={cn(
                            'absolute top-1.5 right-0 bottom-1.5 w-1 cursor-col-resize touch-none rounded-full select-none',
                            'opacity-0 group-hover:bg-border group-hover:opacity-100',
                            header.column.getIsResizing() && 'bg-primary opacity-100',
                          )}
                        />
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody ref={bodyRef}>
            {isLoading ? (
              Array.from({ length: Math.min(pagination.pageSize, 8) }, (_, i) => (
                <tr key={`skeleton-${String(i)}`} aria-hidden="true">
                  {Array.from({ length: visibleColumnCount }, (__, j) => (
                    <td key={j} className="h-row border-b border-border px-2">
                      <Skeleton className="h-3.5 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : error ? (
              <tr>
                <td colSpan={visibleColumnCount}>
                  <ErrorState description={error} {...(onRetry ? { onRetry } : {})} />
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumnCount}>
                  <EmptyState title={emptyTitle} description={emptyDescription} />
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  data-row=""
                  data-row-id={row.id}
                  data-state={row.getIsSelected() ? 'selected' : undefined}
                  tabIndex={0}
                  aria-selected={enableRowSelection ? row.getIsSelected() : undefined}
                  onKeyDown={(e) => {
                    onRowKeyDown(e, row.original);
                  }}
                  onDoubleClick={
                    onRowActivate
                      ? () => {
                          onRowActivate(row.original);
                        }
                      : undefined
                  }
                  className={cn(
                    'outline-none transition-colors hover:bg-muted/60 focus-visible:bg-accent focus-visible:shadow-[inset_2px_0_0_var(--ring)]',
                    'data-[state=selected]:bg-primary/6',
                    onRowActivate && 'cursor-pointer',
                  )}
                >
                  {row.getVisibleCells().map((cell) => {
                    const meta: DataTableColumnMeta | undefined = cell.column.columnDef.meta;
                    return (
                      <td
                        key={cell.id}
                        style={{ width: cell.column.getSize() }}
                        className={cn(
                          'h-row max-w-0 truncate border-b border-border px-2 align-middle',
                          meta?.align === 'right' && 'text-right',
                          meta?.align === 'center' && 'text-center',
                          meta?.numeric && 'tabular',
                        )}
                      >
                        <table.FlexRender cell={cell} />
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {hidePagination ? null : (
        <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1.5 text-sm text-muted-foreground">
          <span className="tabular" aria-live="polite">
            {totalRows === 0
              ? 'No rows'
              : `${String(firstRow)}–${String(lastRow)} of ${String(totalRows)}`}
          </span>
          <div className="flex items-center gap-1">
            <label className="mr-2 flex items-center gap-1.5">
              <span className="hidden sm:inline">Rows per page</span>
              <select
                className="h-7 rounded-md border border-input bg-background px-1.5 text-sm text-foreground"
                value={pagination.pageSize}
                onChange={(e) => {
                  table.setPageSize(Number(e.target.value));
                }}
              >
                {pageSizeOptions.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <span className="mr-1 tabular">
              Page {pagination.pageIndex + 1} of {pageCount}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="First page"
              disabled={!table.getCanPreviousPage()}
              onClick={() => {
                table.firstPage();
              }}
            >
              <ChevronsLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Previous page"
              disabled={!table.getCanPreviousPage()}
              onClick={() => {
                table.previousPage();
              }}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Next page"
              disabled={!table.getCanNextPage()}
              onClick={() => {
                table.nextPage();
              }}
            >
              <ChevronRight />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Last page"
              disabled={!table.getCanNextPage()}
              onClick={() => {
                table.lastPage();
              }}
            >
              <ChevronsRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
