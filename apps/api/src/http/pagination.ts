// Cursor pagination (BE-073): `{ items, nextCursor }`, keyset on (created_at, id). Cursors are
// opaque base64url JSON; a malformed cursor is a 400, never a silent first page.
import { type AnyColumn, type SQL, sql } from 'drizzle-orm';
import { problem } from './problem';

export interface KeysetCursor {
  at: string;
  id: string;
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify({ at: at.toISOString(), id })).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): KeysetCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as KeysetCursor;
    if (typeof parsed.at !== 'string' || Number.isNaN(Date.parse(parsed.at)) || !/^[0-9a-f-]{36}$/.test(parsed.id)) {
      throw new Error('bad cursor');
    }
    return parsed;
  } catch {
    throw problem('validation_failed', 'The cursor is not valid. Start again from the first page.');
  }
}

/**
 * Timestamps are microsecond precision in Postgres but millisecond in JS, so ordering and the
 * keyset comparison both use the millisecond-truncated value (otherwise a row could repeat).
 */
export function msTrunc(createdAt: AnyColumn): SQL {
  return sql`date_trunc('milliseconds', ${createdAt})`;
}

/** Ascending keyset condition; order by msTrunc(createdAt), id. */
export function afterCursor(createdAt: AnyColumn, id: AnyColumn, cursor: KeysetCursor | null): SQL | undefined {
  if (!cursor) return undefined;
  return sql`(${msTrunc(createdAt)}, ${id}) > (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
}

/** Descending keyset condition (newest first); order by msTrunc(createdAt) desc, id desc. */
export function beforeCursor(createdAt: AnyColumn, id: AnyColumn, cursor: KeysetCursor | null): SQL | undefined {
  if (!cursor) return undefined;
  return sql`(${msTrunc(createdAt)}, ${id}) < (${cursor.at}::timestamptz, ${cursor.id}::uuid)`;
}

/** Fetch limit + 1 rows, then call this to split off the next cursor. */
export function pageResult<R, T>(
  rows: R[],
  limit: number,
  key: (row: R) => { at: Date; id: string },
  map: (row: R) => T,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  const lastKey = last ? key(last) : null;
  return {
    items: slice.map(map),
    nextCursor: hasMore && lastKey ? encodeCursor(lastKey.at, lastKey.id) : null,
  };
}
