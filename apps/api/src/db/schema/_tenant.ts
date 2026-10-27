// tenantTable(): every tenant-owned table gets id, org_id (NOT NULL, indexed, FK to organizations),
// created_at, updated_at and UNIQUE (org_id, id) so children can use composite tenant FKs
// (org_id, parent_id) -> parent(org_id, id). A cross-tenant reference therefore fails in Postgres,
// not just in application code. RLS policies are added in drizzle/0002_rls_triggers.sql.
import { createHash } from 'node:crypto';
import type { BuildExtraConfigColumns } from 'drizzle-orm';
import {
  type AnyPgColumn,
  foreignKey,
  index,
  type PgColumnBuilderBase,
  pgTable,
  type PgTableExtraConfigValue,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, idColumn, orgIdColumn, updatedAtColumn } from './_columns';
import { organizations } from './orgs';

/** Postgres identifiers are limited to 63 bytes; longer names get a stable hash suffix. */
export function pgName(raw: string): string {
  if (raw.length <= 63) return raw;
  const hash = createHash('sha1').update(raw).digest('hex').slice(0, 8);
  return `${raw.slice(0, 54)}_${hash}`;
}

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const tenantBase = () => ({
  id: idColumn(),
  orgId: orgIdColumn(),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

type Base = ReturnType<typeof tenantBase>;
export interface TenantParent {
  orgId: AnyPgColumn;
  id: AnyPgColumn;
}
type OnDelete = 'cascade' | 'restrict' | 'no action' | 'set null';

export interface TenantHelpers<T> {
  /** Composite tenant FK (org_id, <col>) -> parent(org_id, id). */
  fk: (col: keyof T & string, parent: () => TenantParent, onDelete?: OnDelete) => PgTableExtraConfigValue;
  idx: (...cols: (keyof T & string)[]) => PgTableExtraConfigValue;
  uniq: (...cols: (keyof T & string)[]) => PgTableExtraConfigValue;
  /** Table-prefixed, length-safe constraint/index name. */
  name: (suffix: string) => string;
}

export function tenantTable<N extends string, C extends Record<string, PgColumnBuilderBase>>(
  tableName: N,
  columns: C,
  extra?: (
    t: BuildExtraConfigColumns<N, Base & C, 'pg'>,
    h: TenantHelpers<BuildExtraConfigColumns<N, Base & C, 'pg'>>,
  ) => PgTableExtraConfigValue[],
) {
  return pgTable(tableName, { ...tenantBase(), ...columns } as Base & C, (t) => {
    const cols = t as unknown as Record<string, AnyPgColumn>;
    const h: TenantHelpers<typeof t> = {
      name: (suffix) => pgName(`${tableName}_${suffix}`),
      fk: (col, parent, onDelete = 'restrict') => {
        const p = parent();
        return foreignKey({
          name: pgName(`${tableName}_${snake(col)}_fk`),
          columns: [cols.orgId!, cols[col]!],
          foreignColumns: [p.orgId, p.id],
        }).onDelete(onDelete);
      },
      idx: (...keys) =>
        index(pgName(`${tableName}_${keys.map(snake).join('_')}_idx`)).on(
          ...(keys.map((k) => cols[k]!) as [AnyPgColumn, ...AnyPgColumn[]]),
        ),
      uniq: (...keys) =>
        uniqueIndex(pgName(`${tableName}_${keys.map(snake).join('_')}_uq`)).on(
          ...(keys.map((k) => cols[k]!) as [AnyPgColumn, ...AnyPgColumn[]]),
        ),
    };
    return [
      index(pgName(`${tableName}_org_id_idx`)).on(cols.orgId!),
      unique(pgName(`${tableName}_org_id_id_uq`)).on(cols.orgId!, cols.id!),
      foreignKey({
        name: pgName(`${tableName}_org_fk`),
        columns: [cols.orgId!],
        foreignColumns: [organizations.id],
      }).onDelete('restrict'),
      ...(extra?.(t, h) ?? []),
    ];
  });
}
