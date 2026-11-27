// Capture engine for portal capture: logs in through an adapter, lists and
// fetches orders, normalizes lines through the org's existing SKU mappings,
// and upserts external orders with dedupe/revision semantics. All writes go
// through a CaptureStore so the engine is unit-testable with an in-memory
// store and the fixture adapter (same pattern as permit-source freshness).
//
// Honesty rules:
//   * No adapter registered for the portal -> run status 'no_adapters'.
//   * Login failure states come from the adapter verbatim (login_failed /
//     portal_changed / blocked) — capture never evades a block.
//   * Unmapped lines stay unmapped and flagged; mapping is exact-match only
//     (no fuzzy equivalence assumed, same as supplierFlow SKU mappings).
//   * Money is integer minor units; totals sum priced lines only and are
//     null when nothing is priced. Nothing here commits money.
import type { PortalConnectionStatus } from '../../db/schema/portalCapture';
import type { PortalAdapter, PortalCredentials, PortalOrderDetail } from './adapter';

export interface NormalizedExternalLine {
  label: string;
  quantity: number;
  unit: string;
  unitPriceMinor: number | null;
  supplierSku: string | null;
  mappingStatus: 'mapped' | 'unmapped';
}

export interface NormalizedExternalOrder {
  builderName: string;
  builderPoNumber: string;
  orderedOn: string | null;
  lines: NormalizedExternalLine[];
  totalMinor: number | null;
  mappedLineCount: number;
  unmappedLineCount: number;
  capturedPayload: unknown;
}

/** Exact-match normalization: builder item/package name -> supplier SKU. */
export function normalizeCapturedOrder(
  detail: PortalOrderDetail,
  mappings: ReadonlyMap<string, string>,
): NormalizedExternalOrder {
  const lines: NormalizedExternalLine[] = detail.lines.map((line) => {
    const label = line.label.trim();
    const supplierSku = mappings.get(label) ?? null;
    return {
      label,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceMinor: line.unitPriceMinor,
      supplierSku,
      mappingStatus: supplierSku ? 'mapped' : 'unmapped',
    };
  });
  let total = 0;
  let priced = false;
  for (const line of lines) {
    if (line.unitPriceMinor === null) continue;
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) continue;
    total += Math.round(line.quantity * line.unitPriceMinor);
    priced = true;
  }
  return {
    builderName: detail.builderName.trim(),
    builderPoNumber: detail.builderPoNumber.trim(),
    orderedOn: detail.orderedOn ?? null,
    lines,
    totalMinor: priced ? total : null,
    mappedLineCount: lines.filter((l) => l.mappingStatus === 'mapped').length,
    unmappedLineCount: lines.filter((l) => l.mappingStatus === 'unmapped').length,
    capturedPayload: detail.raw ?? null,
  };
}

export interface CaptureRunError {
  orderRef?: string | null;
  message: string;
}

export interface CaptureStore {
  createRun(input: {
    connectionId: string;
    trigger: 'manual' | 'scheduled';
    startedAt: Date;
  }): Promise<{ id: string }>;
  finishRun(
    runId: string,
    patch: {
      status: 'succeeded' | 'failed' | 'no_adapters';
      finishedAt: Date;
      ordersFound: number;
      ordersNew: number;
      ordersRevised: number;
      errors: CaptureRunError[];
      note: string | null;
    },
  ): Promise<void>;
  updateConnection(
    connectionId: string,
    patch: { status: PortalConnectionStatus; lastCheckedAt: Date; lastError: string | null },
  ): Promise<void>;
  findExternalOrder(
    connectionId: string,
    builderPoNumber: string,
  ): Promise<{ id: string; revisionCount: number } | null>;
  insertExternalOrder(input: {
    connectionId: string;
    order: NormalizedExternalOrder;
    capturedAt: Date;
  }): Promise<void>;
  reviseExternalOrder(
    orderId: string,
    input: { order: NormalizedExternalOrder; capturedAt: Date; revisionCount: number },
  ): Promise<void>;
  listSkuMappings(): Promise<{ packageName: string; supplierSku: string }[]>;
}

export interface CaptureOutcome {
  runId: string;
  status: 'succeeded' | 'failed' | 'no_adapters';
  ordersFound: number;
  ordersNew: number;
  ordersRevised: number;
  errors: CaptureRunError[];
  note: string | null;
}

const NO_ADAPTER_NOTE = (portalKey: string) =>
  `No portal adapter is registered for "${portalKey}". Adapters are added per builder portal after verification against a real supplier-authorized account.`;

export async function runCapture(input: {
  store: CaptureStore;
  connection: { id: string; portalKey: string };
  adapter: PortalAdapter | null;
  /** Null when the vault key is unavailable or the secret cannot be unsealed. */
  credentials: PortalCredentials | null;
  trigger: 'manual' | 'scheduled';
  now?: () => Date;
}): Promise<CaptureOutcome> {
  const now = input.now ?? (() => new Date());
  const startedAt = now();
  const { id: runId } = await input.store.createRun({
    connectionId: input.connection.id,
    trigger: input.trigger,
    startedAt,
  });
  const finish = async (
    status: CaptureOutcome['status'],
    counts: { found: number; fresh: number; revised: number },
    errors: CaptureRunError[],
    note: string | null,
  ): Promise<CaptureOutcome> => {
    await input.store.finishRun(runId, {
      status,
      finishedAt: now(),
      ordersFound: counts.found,
      ordersNew: counts.fresh,
      ordersRevised: counts.revised,
      errors,
      note,
    });
    return {
      runId,
      status,
      ordersFound: counts.found,
      ordersNew: counts.fresh,
      ordersRevised: counts.revised,
      errors,
      note,
    };
  };

  if (!input.adapter) {
    return finish('no_adapters', { found: 0, fresh: 0, revised: 0 }, [], NO_ADAPTER_NOTE(input.connection.portalKey));
  }
  if (!input.credentials) {
    const message =
      'Portal credentials could not be read: the credential vault is not configured (STORAGE_ENCRYPTION_KEY) or the stored secret cannot be unsealed.';
    await input.store.updateConnection(input.connection.id, {
      status: 'not_connected',
      lastCheckedAt: now(),
      lastError: message,
    });
    return finish('failed', { found: 0, fresh: 0, revised: 0 }, [{ message }], message);
  }

  const login = await input.adapter.login(input.credentials);
  if (!login.ok) {
    await input.store.updateConnection(input.connection.id, {
      status: login.state,
      lastCheckedAt: now(),
      lastError: login.error,
    });
    return finish('failed', { found: 0, fresh: 0, revised: 0 }, [{ message: login.error }], login.error);
  }

  const errors: CaptureRunError[] = [];
  let found = 0;
  let fresh = 0;
  let revised = 0;
  try {
    const mappings = new Map(
      (await input.store.listSkuMappings()).map((m) => [m.packageName, m.supplierSku] as const),
    );
    const summaries = await input.adapter.listOrders(login.session);
    found = summaries.length;
    for (const summary of summaries) {
      try {
        const detail = await input.adapter.fetchOrder(login.session, summary.builderPoNumber);
        const order = normalizeCapturedOrder(detail, mappings);
        const existing = await input.store.findExternalOrder(input.connection.id, order.builderPoNumber);
        if (existing) {
          await input.store.reviseExternalOrder(existing.id, {
            order,
            capturedAt: now(),
            revisionCount: existing.revisionCount + 1,
          });
          revised += 1;
        } else {
          await input.store.insertExternalOrder({
            connectionId: input.connection.id,
            order,
            capturedAt: now(),
          });
          fresh += 1;
        }
      } catch (error) {
        errors.push({
          orderRef: summary.builderPoNumber,
          message: error instanceof Error ? error.message : 'Order capture failed.',
        });
      }
    }
  } catch (error) {
    // Login worked but listing/fetching broke: the portal most likely changed
    // shape. Report 'portal_changed' honestly instead of claiming success.
    const message = error instanceof Error ? error.message : 'Order capture failed.';
    await input.store.updateConnection(input.connection.id, {
      status: 'portal_changed',
      lastCheckedAt: now(),
      lastError: message,
    });
    return finish('failed', { found, fresh, revised }, [{ message }], message);
  }

  await input.store.updateConnection(input.connection.id, {
    status: 'connected',
    lastCheckedAt: now(),
    lastError: errors.length > 0 ? errors[0]!.message : null,
  });
  return finish('succeeded', { found, fresh, revised }, errors, null);
}
