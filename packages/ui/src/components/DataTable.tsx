'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { SortIcon } from '../icons';
import { cx } from '../internal/cx';
import type { ViewState } from '../types';
import { ViewStateBoundary } from './EmptyState';

export type SortDirection = 'asc' | 'desc';

export interface DataTableColumn<Row> {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** Value used for sorting; providing it makes the column sortable. */
  sortValue?: (row: Row) => string | number | bigint | null;
  align?: 'start' | 'end';
  /** Marks the column that names the row; it becomes the card title on phones. */
  primary?: boolean;
}

export interface DataTableProps<Row> {
  columns: ReadonlyArray<DataTableColumn<Row>>;
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Table caption: required, it is the table's accessible name. */
  caption: string;
  captionHidden?: boolean;
  defaultSort?: { columnId: string; direction: SortDirection };
  /** Loading / empty / error / permission-denied. Defaults to ready (or empty when no rows). */
  state?: ViewState;
  emptyTitle?: string;
  className?: string;
}

function compare(a: string | number | bigint | null, b: string | number | bigint | null): number {
  if (a === b) return 0;
  // Unknown (null) values always sort last regardless of direction handling below.
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'en');
  return a < b ? -1 : 1;
}

/**
 * Semantic <table> with sortable column headers (buttons inside <th aria-sort>). Below the phone
 * breakpoint styles.css turns each row into a card and shows the `data-label` of each cell, so
 * the same markup stays a real table for screen readers. Sorting is stable: ties keep input order.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  captionHidden = false,
  defaultSort,
  state,
  emptyTitle = 'Nothing here yet',
  className,
}: DataTableProps<Row>) {
  const [sort, setSort] = useState(defaultSort);
  const sorted = useMemo(() => {
    const column = sort && columns.find((c) => c.id === sort.columnId);
    if (!column?.sortValue || !sort) return rows;
    const get = column.sortValue;
    return rows
      .map((row, index) => ({ row, index, key: get(row) }))
      .sort((x, y) => {
        if (x.key === null || y.key === null) return compare(x.key, y.key) || x.index - y.index;
        const c = compare(x.key, y.key);
        return (sort.direction === 'asc' ? c : -c) || x.index - y.index;
      })
      .map((entry) => entry.row);
  }, [rows, columns, sort]);

  const effective: ViewState =
    state ?? (rows.length === 0 ? { status: 'empty', title: emptyTitle } : { status: 'ready' });

  const toggle = (columnId: string) =>
    setSort((prev) =>
      prev?.columnId === columnId
        ? { columnId, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { columnId, direction: 'asc' },
    );

  return (
    <div className={cx('fl-table-wrap', className)}>
      <ViewStateBoundary state={effective} headingLevel={3}>
        <table className="fl-table">
          <caption className={cx('fl-table__caption', captionHidden && 'fl-visually-hidden')}>
            {caption}
          </caption>
          <thead>
            <tr>
              {columns.map((column) => {
                const active = sort?.columnId === column.id;
                const ariaSort = active
                  ? sort.direction === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : column.sortValue
                    ? 'none'
                    : undefined;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={cx(column.align === 'end' && 'fl-table__cell--end')}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        className="fl-table__sort"
                        onClick={() => toggle(column.id)}
                      >
                        {column.header}
                        <SortIcon size={16} direction={active ? sort.direction : 'none'} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) =>
                  column.primary ? (
                    <th
                      key={column.id}
                      scope="row"
                      data-label={column.header}
                      className="fl-table__primary"
                    >
                      {column.cell(row)}
                    </th>
                  ) : (
                    <td
                      key={column.id}
                      data-label={column.header}
                      className={cx(column.align === 'end' && 'fl-table__cell--end')}
                    >
                      {column.cell(row)}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ViewStateBoundary>
    </div>
  );
}
