import { and, eq } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { EnterpriseTakeoffMeasurementKind, EnterpriseTakeoffUnit } from '@fieldline/contracts';
import type { z } from 'zod';
import {
  enterpriseTakeoffAreas as areas,
  enterpriseTakeoffCountSets as counts,
  enterpriseTakeoffLengths as lengths,
} from '../../db/schema/enterpriseTakeoff';
import type { Tx } from '../../db/runtime';
import { problem } from '../../http/problem';
import type { TakeoffSheetScope } from './takeoffCalibration';

export type TakeoffMeasurementKind = z.infer<typeof EnterpriseTakeoffMeasurementKind>;

export function sheetScope(
  table: { [Key in keyof TakeoffSheetScope]: PgColumn },
  { orgId, projectId, planId, sheetId }: TakeoffSheetScope,
) {
  return and(
    eq(table.orgId, orgId),
    eq(table.projectId, projectId),
    eq(table.planId, planId),
    eq(table.sheetId, sheetId),
  );
}

export type MeasurementSnapshot = {
  revision: number;
  quantity: number;
  unit: EnterpriseTakeoffUnit | null;
  calibrationId: string | null;
};

export async function readMeasurement(
  tx: Tx,
  scope: TakeoffSheetScope,
  kind: TakeoffMeasurementKind,
  id: string,
  lockCount = false,
): Promise<MeasurementSnapshot> {
  if (kind === 'count') {
    const query = tx
      .select({ revision: counts.revision, quantity: counts.activeCount })
      .from(counts)
      .where(and(sheetScope(counts, scope), eq(counts.id, id)));
    const [row] = lockCount ? await query.for('update') : await query;
    if (!row) throw problem('not_found');
    return { ...row, unit: null, calibrationId: null };
  }
  const source =
    kind === 'length'
      ? { table: lengths, quantity: lengths.length }
      : { table: areas, quantity: areas.netArea };
  const [row] = await tx
    .select({
      quantity: source.quantity,
      unit: source.table.unit,
      calibrationId: source.table.calibrationId,
    })
    .from(source.table)
    .where(and(sheetScope(source.table, scope), eq(source.table.id, id)));
  if (!row) throw problem('not_found');
  return { ...row, revision: 1 };
}
