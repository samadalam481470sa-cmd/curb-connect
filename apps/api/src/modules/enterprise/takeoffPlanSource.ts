import { and, eq } from 'drizzle-orm';
import { enterpriseDocumentVersions as versions } from '../../db/schema/enterpriseDocuments';
import {
  enterpriseTakeoffPlanSets as plans,
  enterpriseTakeoffPlanSheets as sheets,
} from '../../db/schema/enterpriseTakeoff';
import type { Tx } from '../../db/runtime';
import { problem } from '../../http/problem';
import type { TakeoffSheetScope } from './takeoffCalibration';

export async function readTakeoffPlanSource(tx: Tx, scope: TakeoffSheetScope) {
  const [row] = await tx
    .select({
      sheet: sheets,
      planTitle: plans.title,
      revisionLabel: plans.revisionLabel,
      documentSetId: versions.documentSetId,
      file: {
        storageKey: versions.storageKey,
        byteSize: versions.byteSize,
        sha256Hex: versions.sha256Hex,
      },
    })
    .from(sheets)
    .innerJoin(
      plans,
      and(
        eq(plans.id, sheets.planId),
        eq(plans.orgId, sheets.orgId),
        eq(plans.projectId, sheets.projectId),
      ),
    )
    .innerJoin(
      versions,
      and(
        eq(versions.id, sheets.sourceVersionId),
        eq(versions.orgId, sheets.orgId),
        eq(versions.projectId, sheets.projectId),
      ),
    )
    .where(
      and(
        eq(sheets.id, scope.sheetId),
        eq(sheets.orgId, scope.orgId),
        eq(sheets.projectId, scope.projectId),
        eq(sheets.planId, scope.planId),
      ),
    );
  if (!row)
    throw problem('not_found', 'Choose a sheet from the selected project and plan revision.');
  return row;
}
