// Scheduled portal capture (graphile-worker crontab, see worker.ts):
//   portal_capture_run: daily 6:30 am Texas time, runs one capture per
//   stored builder-portal connection across all orgs.
// With zero live adapters registered (the current honest state — adapters
// are added per builder portal after verification against a real
// supplier-authorized account), every run records 'no_adapters' and nothing
// is fetched. Adapters use plain authorized login with the supplier's own
// credentials only — no anti-bot evasion; a blocked portal is reported as
// 'blocked', never fought. Secrets are unsealed in memory only and never
// logged or put in job payloads.
import type { Task } from 'graphile-worker';
import { portalConnections } from '../db/schema';
import { withPlatform, type Tx } from '../db/runtime';
import { PORTAL_ADAPTERS } from '../modules/portalCapture/adapter';
import { runCapture } from '../modules/portalCapture/capture';
import { dbCaptureStore } from '../modules/portalCapture/store';
import { unsealPortalSecret, vaultKeyFromConfig } from '../modules/portalCapture/vault';
import type { WorkerDeps } from './tasks';

export const PORTAL_CAPTURE_CRONTAB =
  // 12:30 UTC = 6:30 am CST (7:30 am during daylight time).
  '30 12 * * * portal_capture_run';

export function portalCaptureTasks(deps: WorkerDeps): Record<string, Task> {
  return {
    portal_capture_run: async (_payload, helpers) => {
      const connections = await withPlatform(
        deps.platformDb,
        'worker.task',
        null,
        async (tx: Tx) =>
          tx
            .select({
              id: portalConnections.id,
              orgId: portalConnections.orgId,
              portalKey: portalConnections.portalKey,
              loginIdentifier: portalConnections.loginIdentifier,
              secretSealed: portalConnections.secretSealed,
            })
            .from(portalConnections),
        { orgId: null, userId: null },
      );
      if (connections.length === 0) {
        helpers.logger.info('[portal-capture] no portal connections stored; nothing to capture');
        return;
      }
      const key = vaultKeyFromConfig(deps.config.storage.encryptionKey);
      for (const connection of connections) {
        const adapter = PORTAL_ADAPTERS.get(connection.portalKey) ?? null;
        let credentials: { loginIdentifier: string; secret: string } | null = null;
        if (adapter && key) {
          try {
            credentials = {
              loginIdentifier: connection.loginIdentifier,
              secret: unsealPortalSecret(key, connection.secretSealed),
            };
          } catch {
            credentials = null;
          }
        }
        const store = dbCaptureStore(
          (fn) =>
            withPlatform(deps.platformDb, 'worker.task', null, fn, {
              orgId: connection.orgId,
              userId: null,
            }),
          connection.orgId,
        );
        const outcome = await runCapture({
          store,
          connection: { id: connection.id, portalKey: connection.portalKey },
          adapter,
          credentials,
          trigger: 'scheduled',
        });
        helpers.logger.info(
          `[portal-capture] ${connection.portalKey}: ${outcome.status} — found ${outcome.ordersFound}, new ${outcome.ordersNew}, revised ${outcome.ordersRevised}`,
        );
      }
    },
  };
}
