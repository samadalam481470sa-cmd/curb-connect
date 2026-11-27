// Database-backed CaptureStore. The caller supplies `run` (one short
// transaction per store call) so the same store works from the API
// (tenantTx, RLS-scoped) and from the worker (platform role with the org
// scope set, filtering by org explicitly). Every query is org-scoped.
import { and, eq } from 'drizzle-orm';
import { externalOrders, portalCaptureRuns, portalConnections, skuMappings } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import type { CaptureStore } from './capture';

export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

export function dbCaptureStore(run: TxRunner, orgId: string): CaptureStore {
  return {
    async createRun(input) {
      return run(async (tx) => {
        const [row] = await tx
          .insert(portalCaptureRuns)
          .values({
            orgId,
            connectionId: input.connectionId,
            trigger: input.trigger,
            status: 'running',
            startedAt: input.startedAt,
          })
          .returning({ id: portalCaptureRuns.id });
        if (!row) throw new Error('capture run insert returned no row');
        return { id: row.id };
      });
    },
    async finishRun(runId, patch) {
      await run(async (tx) => {
        await tx
          .update(portalCaptureRuns)
          .set({
            status: patch.status,
            finishedAt: patch.finishedAt,
            ordersFound: patch.ordersFound,
            ordersNew: patch.ordersNew,
            ordersRevised: patch.ordersRevised,
            errors: patch.errors,
            note: patch.note,
            updatedAt: new Date(),
          })
          .where(and(eq(portalCaptureRuns.orgId, orgId), eq(portalCaptureRuns.id, runId)));
      });
    },
    async updateConnection(connectionId, patch) {
      await run(async (tx) => {
        await tx
          .update(portalConnections)
          .set({
            status: patch.status,
            lastCheckedAt: patch.lastCheckedAt,
            lastError: patch.lastError,
            updatedAt: new Date(),
          })
          .where(and(eq(portalConnections.orgId, orgId), eq(portalConnections.id, connectionId)));
      });
    },
    async findExternalOrder(connectionId, builderPoNumber) {
      return run(async (tx) => {
        const [row] = await tx
          .select({ id: externalOrders.id, revisionCount: externalOrders.revisionCount })
          .from(externalOrders)
          .where(
            and(
              eq(externalOrders.orgId, orgId),
              eq(externalOrders.connectionId, connectionId),
              eq(externalOrders.builderPoNumber, builderPoNumber),
            ),
          );
        return row ?? null;
      });
    },
    async insertExternalOrder(input) {
      await run(async (tx) => {
        await tx.insert(externalOrders).values({
          orgId,
          connectionId: input.connectionId,
          builderName: input.order.builderName,
          builderPoNumber: input.order.builderPoNumber,
          orderedOn: input.order.orderedOn,
          capturedPayload: input.order.capturedPayload ?? {},
          lines: input.order.lines,
          totalMinor: input.order.totalMinor,
          status: 'captured',
          revisionCount: 0,
          lastCapturedAt: input.capturedAt,
        });
      });
    },
    async reviseExternalOrder(orderId, input) {
      await run(async (tx) => {
        await tx
          .update(externalOrders)
          .set({
            builderName: input.order.builderName,
            orderedOn: input.order.orderedOn,
            capturedPayload: input.order.capturedPayload ?? {},
            lines: input.order.lines,
            totalMinor: input.order.totalMinor,
            revisionCount: input.revisionCount,
            lastCapturedAt: input.capturedAt,
            updatedAt: new Date(),
          })
          .where(and(eq(externalOrders.orgId, orgId), eq(externalOrders.id, orderId)));
      });
    },
    async listSkuMappings() {
      return run(async (tx) =>
        tx
          .select({ packageName: skuMappings.packageName, supplierSku: skuMappings.supplierSku })
          .from(skuMappings)
          .where(eq(skuMappings.orgId, orgId)),
      );
    },
  };
}
