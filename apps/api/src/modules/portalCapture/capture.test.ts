import { describe, expect, it } from 'vitest';
import type { PortalOrderDetail } from './adapter';
import {
  normalizeCapturedOrder,
  runCapture,
  type CaptureStore,
  type NormalizedExternalOrder,
} from './capture';
import { fixturePortalAdapter } from './fixtureAdapter';

const MAPPINGS = new Map([
  ['2x4 Stud Package', 'SKU-STUD-24'],
  ['OSB 7/16 Sheet', 'SKU-OSB-716'],
]);

function detail(po: string, lines: PortalOrderDetail['lines']): PortalOrderDetail {
  return {
    builderPoNumber: po,
    builderName: 'Acme Builders',
    orderedOn: '2026-11-25',
    lines,
    raw: { po },
  };
}

describe('normalizeCapturedOrder', () => {
  it('maps exact package names and flags the rest unmapped', () => {
    const order = normalizeCapturedOrder(
      detail('PO-1', [
        { label: '2x4 Stud Package', quantity: 100, unit: 'pc', unitPriceMinor: 475 },
        { label: 'Mystery Widget', quantity: 5, unit: 'ea', unitPriceMinor: 1200 },
      ]),
      MAPPINGS,
    );
    expect(order.lines[0]).toMatchObject({ supplierSku: 'SKU-STUD-24', mappingStatus: 'mapped' });
    expect(order.lines[1]).toMatchObject({ supplierSku: null, mappingStatus: 'unmapped' });
    expect(order.mappedLineCount).toBe(1);
    expect(order.unmappedLineCount).toBe(1);
  });

  it('totals priced lines only, in integer minor units', () => {
    const order = normalizeCapturedOrder(
      detail('PO-2', [
        { label: '2x4 Stud Package', quantity: 100, unit: 'pc', unitPriceMinor: 475 },
        { label: 'OSB 7/16 Sheet', quantity: 20, unit: 'sheet', unitPriceMinor: null },
      ]),
      MAPPINGS,
    );
    expect(order.totalMinor).toBe(47_500);
  });

  it('nothing priced -> null total (never invented)', () => {
    const order = normalizeCapturedOrder(
      detail('PO-3', [{ label: 'X', quantity: 1, unit: 'ea', unitPriceMinor: null }]),
      MAPPINGS,
    );
    expect(order.totalMinor).toBeNull();
  });

  it('trims labels before matching (exact match after trim, no fuzzy)', () => {
    const order = normalizeCapturedOrder(
      detail('PO-4', [
        { label: '  2x4 Stud Package  ', quantity: 1, unit: 'pc', unitPriceMinor: null },
        { label: '2x4 stud package', quantity: 1, unit: 'pc', unitPriceMinor: null },
      ]),
      MAPPINGS,
    );
    expect(order.lines[0]?.mappingStatus).toBe('mapped');
    expect(order.lines[1]?.mappingStatus).toBe('unmapped');
  });
});

// ---------------------------------------------------------- in-memory store

interface StoredRun {
  id: string;
  status: string;
  ordersFound: number;
  ordersNew: number;
  ordersRevised: number;
  errors: { orderRef?: string | null; message: string }[];
  note: string | null;
}

function memoryStore() {
  const runs = new Map<string, StoredRun>();
  const orders = new Map<string, { id: string; revisionCount: number; order: NormalizedExternalOrder }>();
  const connectionPatches: { status: string; lastError: string | null }[] = [];
  let seq = 0;
  const store: CaptureStore = {
    async createRun() {
      seq += 1;
      const id = `run-${seq}`;
      runs.set(id, { id, status: 'running', ordersFound: 0, ordersNew: 0, ordersRevised: 0, errors: [], note: null });
      return { id };
    },
    async finishRun(runId, patch) {
      const run = runs.get(runId)!;
      run.status = patch.status;
      run.ordersFound = patch.ordersFound;
      run.ordersNew = patch.ordersNew;
      run.ordersRevised = patch.ordersRevised;
      run.errors = patch.errors;
      run.note = patch.note;
    },
    async updateConnection(_id, patch) {
      connectionPatches.push({ status: patch.status, lastError: patch.lastError });
    },
    async findExternalOrder(connectionId, builderPoNumber) {
      const found = orders.get(`${connectionId}:${builderPoNumber}`);
      return found ? { id: found.id, revisionCount: found.revisionCount } : null;
    },
    async insertExternalOrder(input) {
      seq += 1;
      orders.set(`${input.connectionId}:${input.order.builderPoNumber}`, {
        id: `order-${seq}`,
        revisionCount: 0,
        order: input.order,
      });
    },
    async reviseExternalOrder(orderId, input) {
      for (const [k, v] of orders) {
        if (v.id === orderId) orders.set(k, { id: v.id, revisionCount: input.revisionCount, order: input.order });
      }
    },
    async listSkuMappings() {
      return [...MAPPINGS.entries()].map(([packageName, supplierSku]) => ({ packageName, supplierSku }));
    },
  };
  return { store, runs, orders, connectionPatches };
}

const CONNECTION = { id: 'conn-1', portalKey: 'fixture-portal' };
const CREDS = { loginIdentifier: 'supplier@example.com', secret: 'fixture-secret' };
const NOW = () => new Date('2026-11-27T12:00:00.000Z');

describe('runCapture lifecycle (fixture adapter)', () => {
  it('no adapter -> honest no_adapters run, connection untouched', async () => {
    const { store, runs, connectionPatches } = memoryStore();
    const outcome = await runCapture({
      store,
      connection: CONNECTION,
      adapter: null,
      credentials: CREDS,
      trigger: 'manual',
      now: NOW,
    });
    expect(outcome.status).toBe('no_adapters');
    expect(outcome.note).toContain('No portal adapter is registered');
    expect(runs.get(outcome.runId)?.status).toBe('no_adapters');
    expect(connectionPatches).toHaveLength(0);
  });

  it('captures new orders and marks the connection connected', async () => {
    const { store, orders, connectionPatches } = memoryStore();
    const adapter = fixturePortalAdapter({
      orders: [
        detail('PO-100', [{ label: '2x4 Stud Package', quantity: 10, unit: 'pc', unitPriceMinor: 475 }]),
        detail('PO-101', [{ label: 'Unknown Item', quantity: 2, unit: 'ea', unitPriceMinor: null }]),
      ],
    });
    const outcome = await runCapture({
      store,
      connection: CONNECTION,
      adapter,
      credentials: CREDS,
      trigger: 'scheduled',
      now: NOW,
    });
    expect(outcome).toMatchObject({ status: 'succeeded', ordersFound: 2, ordersNew: 2, ordersRevised: 0 });
    expect(orders.size).toBe(2);
    expect(connectionPatches.at(-1)).toEqual({ status: 'connected', lastError: null });
  });

  it('re-capture of the same builder PO is a revision, never a duplicate', async () => {
    const { store, orders } = memoryStore();
    const first = fixturePortalAdapter({
      orders: [detail('PO-200', [{ label: '2x4 Stud Package', quantity: 10, unit: 'pc', unitPriceMinor: 475 }])],
    });
    await runCapture({ store, connection: CONNECTION, adapter: first, credentials: CREDS, trigger: 'manual', now: NOW });
    const second = fixturePortalAdapter({
      orders: [detail('PO-200', [{ label: '2x4 Stud Package', quantity: 12, unit: 'pc', unitPriceMinor: 475 }])],
    });
    const outcome = await runCapture({
      store,
      connection: CONNECTION,
      adapter: second,
      credentials: CREDS,
      trigger: 'manual',
      now: NOW,
    });
    expect(outcome).toMatchObject({ status: 'succeeded', ordersNew: 0, ordersRevised: 1 });
    expect(orders.size).toBe(1);
    const stored = [...orders.values()][0]!;
    expect(stored.revisionCount).toBe(1);
    expect(stored.order.lines[0]?.quantity).toBe(12);
  });

  it('bad secret -> login_failed state on the connection, failed run', async () => {
    const { store, connectionPatches } = memoryStore();
    const outcome = await runCapture({
      store,
      connection: CONNECTION,
      adapter: fixturePortalAdapter({ orders: [] }),
      credentials: { loginIdentifier: 'supplier@example.com', secret: 'wrong' },
      trigger: 'manual',
      now: NOW,
    });
    expect(outcome.status).toBe('failed');
    expect(connectionPatches.at(-1)?.status).toBe('login_failed');
  });

  it('blocked portal -> blocked state, never evaded', async () => {
    const { store, connectionPatches } = memoryStore();
    const outcome = await runCapture({
      store,
      connection: CONNECTION,
      adapter: fixturePortalAdapter({ loginFailure: 'blocked', orders: [] }),
      credentials: CREDS,
      trigger: 'scheduled',
      now: NOW,
    });
    expect(outcome.status).toBe('failed');
    expect(connectionPatches.at(-1)?.status).toBe('blocked');
  });

  it('missing credentials (vault unavailable) -> failed run with honest note', async () => {
    const { store } = memoryStore();
    const outcome = await runCapture({
      store,
      connection: CONNECTION,
      adapter: fixturePortalAdapter({ orders: [] }),
      credentials: null,
      trigger: 'manual',
      now: NOW,
    });
    expect(outcome.status).toBe('failed');
    expect(outcome.note).toContain('credential vault is not configured');
  });

  it('one failing order does not sink the run; error is recorded per order', async () => {
    const { store, orders } = memoryStore();
    const adapter = fixturePortalAdapter({
      orders: [
        detail('PO-300', [{ label: '2x4 Stud Package', quantity: 1, unit: 'pc', unitPriceMinor: 100 }]),
        detail('PO-301', [{ label: '2x4 Stud Package', quantity: 1, unit: 'pc', unitPriceMinor: 100 }]),
      ],
      failingPoNumbers: ['PO-301'],
    });
    const outcome = await runCapture({
      store,
      connection: CONNECTION,
      adapter,
      credentials: CREDS,
      trigger: 'manual',
      now: NOW,
    });
    expect(outcome.status).toBe('succeeded');
    expect(outcome.ordersNew).toBe(1);
    expect(outcome.errors).toHaveLength(1);
    expect(outcome.errors[0]?.orderRef).toBe('PO-301');
    expect(orders.size).toBe(1);
  });
});
