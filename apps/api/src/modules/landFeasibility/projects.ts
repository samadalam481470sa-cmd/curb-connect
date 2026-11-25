// Saved land-feasibility projects: row -> API DTO. The summary is stored exactly as the
// client computed it at save time and labeled 'client-computed' — the server never
// recomputes it (runFeasibility lives in the web app, apps/web/src/features/build/).
import {
  SavedLandFeasibilityProjectSchema,
  type SavedLandFeasibilityProject,
} from '@fieldline/contracts';
import type { landFeasibilityProjects } from '../../db/schema';

type ProjectRow = typeof landFeasibilityProjects.$inferSelect;

export function projectDto(row: ProjectRow): SavedLandFeasibilityProject {
  return SavedLandFeasibilityProjectSchema.parse({
    id: row.id,
    name: row.name,
    inputs: row.inputs,
    summary: row.summary,
    summarySource: 'client-computed',
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}
