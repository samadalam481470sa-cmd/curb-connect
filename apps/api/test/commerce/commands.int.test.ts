// ADD-014-QA / ADD-015-QA / ADD-078-QA / COS-326-QA: the command/receipt protocol of the starter
// (sections C-D): Idempotency-Key = command_id, replay returns the original receipt, a changed body
// is rejected, a stale expected_revision returns 409 with a non-sensitive diff, the receipt is
// recoverable after a client timeout, one transaction writes aggregate + audit + outbox + receipt,
// reads emit nothing, and tenancy/permissions are enforced before any data is read.
import { randomUUID } from 'node:crypto';
import { CommandReceiptSchema, ProblemSchema } from '@fieldline/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, createCompany, createTestContext, type TestContext } from '../helpers';
import { countRows, createProperty, fixtureCandidate } from './fixtures';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(() => ctx?.close());

const pin = (lon: number, lat: number) => ({ type: 'Point', coordinates: [lon, lat] });

async function setup() {
  const a = await createCompany(ctx, { roles: ['estimator', 'read_only'] });
  const candidate = await fixtureCandidate(ctx, a.owner, '100 Fixture Way');
  const property = await createProperty(ctx, a.owner, { originalQuery: '100 Fixture Way', candidate });
  return { a, property };
}

function envelope(aggregateId: string, expected: number, location = pin(0.0101, 0.0101), id = randomUUID()) {
  return {
    command_type: 'PropertyPinRelocated',
    command_id: id,
    aggregate_id: aggregateId,
    expected_revision: expected,
    client_timestamp: new Date().toISOString(),
    payload: { location },
  };
}

describe('COS-326-QA POST /v1/commands', () => {
  it('commits once, replays the same receipt, and writes aggregate + audit + outbox + receipt together', async () => {
    const { a, property } = await setup();
    const auditBefore = await countRows(ctx, 'audit_events', a.orgId);
    const eventsBefore = await countRows(ctx, 'domain_events', a.orgId);
    const body = envelope(property.id, property.revision);
    const first = await call(ctx, 'POST', '/v1/commands', { as: a.as('estimator'), body, headers: { 'idempotency-key': body.command_id, 'x-request-id': 'corr-cmd-0001' } });
    expect(first.statusCode, first.body).toBe(201);
    const receipt = CommandReceiptSchema.parse(first.json());
    expect(receipt).toMatchObject({ command_id: body.command_id, status: 'committed', aggregate_id: property.id, server_revision: property.revision + 1, correlation_id: 'corr-cmd-0001' });
    expect(await countRows(ctx, 'audit_events', a.orgId)).toBe(auditBefore + 1);
    expect(await countRows(ctx, 'domain_events', a.orgId)).toBe(eventsBefore + 1);
    expect(await countRows(ctx, 'command_receipts', a.orgId)).toBe(1);

    // Duplicate submit (double click / retry): same receipt, nothing written twice.
    const replay = await call(ctx, 'POST', '/v1/commands', { as: a.as('estimator'), body: { ...body, client_timestamp: new Date().toISOString() }, headers: { 'idempotency-key': body.command_id } });
    expect(replay.statusCode).toBe(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.json()).toEqual(receipt);
    expect(await countRows(ctx, 'audit_events', a.orgId)).toBe(auditBefore + 1);
    expect(await countRows(ctx, 'domain_events', a.orgId)).toBe(eventsBefore + 1);

    // Same id, different payload: rejected, not silently replayed.
    const reused = await call(ctx, 'POST', '/v1/commands', { as: a.as('estimator'), body: { ...body, payload: { location: pin(0.0102, 0.0102) } }, headers: { 'idempotency-key': body.command_id } });
    expect(reused.statusCode).toBe(422);
    expect(reused.json().code).toBe('idempotency_key_reused');

    // The original geocoded point is preserved; the confirmed pin moved.
    const after = await call(ctx, 'GET', `/v1/properties/${property.id}`, { as: a.owner });
    expect(after.json().location).toEqual(pin(0.01, 0.01));
    expect(after.json().confirmedLocation).toEqual(pin(0.0101, 0.0101));
    expect(after.json().originalQuery).toBe('100 Fixture Way');
  });

  it('returns 409 revision_conflict with the server revision and a field diff', async () => {
    const { a, property } = await setup();
    const one = envelope(property.id, property.revision, pin(0.0103, 0.0103));
    expect((await call(ctx, 'POST', '/v1/commands', { as: a.owner, body: one, headers: { 'idempotency-key': one.command_id } })).statusCode).toBe(201);
    const stale = envelope(property.id, property.revision, pin(0.0104, 0.0104));
    const res = await call(ctx, 'POST', '/v1/commands', { as: a.as('estimator'), body: stale, headers: { 'idempotency-key': stale.command_id } });
    expect(res.statusCode).toBe(409);
    const problem = ProblemSchema.parse(res.json());
    expect(problem.code).toBe('revision_conflict');
    expect(problem.conflict).toMatchObject({ aggregateId: property.id, expectedRevision: property.revision, serverRevision: property.revision + 1 });
    expect(problem.conflict!.diff).toEqual([{ field: 'confirmedLocation', server: pin(0.0103, 0.0103), yours: pin(0.0104, 0.0104) }]);
    // Nothing committed for the rejected command: its receipt does not exist.
    expect((await call(ctx, 'GET', `/v1/commands/${stale.command_id}`, { as: a.owner })).statusCode).toBe(404);
  });

  it('recovers the receipt after a client timeout (GET /v1/commands/{id}); unknown ids are 404', async () => {
    const { a, property } = await setup();
    const body = envelope(property.id, property.revision);
    const sent = await call(ctx, 'POST', '/v1/commands', { as: a.owner, body, headers: { 'idempotency-key': body.command_id } });
    expect(sent.statusCode).toBe(201);
    // The client never saw the response: it asks for the authoritative state instead of assuming.
    const auditBefore = await countRows(ctx, 'audit_events', a.orgId);
    const eventsBefore = await countRows(ctx, 'domain_events', a.orgId);
    const lookup = await call(ctx, 'GET', `/v1/commands/${body.command_id}`, { as: a.as('read_only') });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json()).toEqual(sent.json());
    const missing = await call(ctx, 'GET', `/v1/commands/${randomUUID()}`, { as: a.owner });
    expect(missing.statusCode).toBe(404);
    // Reads never create mutation events.
    await call(ctx, 'GET', `/v1/properties/${property.id}`, { as: a.owner });
    await call(ctx, 'GET', `/v1/properties/${property.id}/structures`, { as: a.owner });
    expect(await countRows(ctx, 'audit_events', a.orgId)).toBe(auditBefore);
    expect(await countRows(ctx, 'domain_events', a.orgId)).toBe(eventsBefore);
  });

  it('validates the envelope: key must equal command_id, unknown types and bad payloads rejected', async () => {
    const { a, property } = await setup();
    const body = envelope(property.id, property.revision);
    const noKey = await call(ctx, 'POST', '/v1/commands', { as: a.owner, body });
    expect(noKey.json().code).toBe('idempotency_key_required');
    const mismatch = await call(ctx, 'POST', '/v1/commands', { as: a.owner, body, headers: { 'idempotency-key': randomUUID() } });
    expect(mismatch.statusCode).toBe(400);
    const unknown = await call(ctx, 'POST', '/v1/commands', { as: a.owner, body: { ...body, command_type: 'LaunchRocket' }, headers: { 'idempotency-key': body.command_id } });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().errors[0].code).toBe('unknown_command');
    const badPayload = await call(ctx, 'POST', '/v1/commands', { as: a.owner, body: { ...body, payload: { location: 'here' } }, headers: { 'idempotency-key': body.command_id } });
    expect(badPayload.statusCode).toBe(400);
    expect(badPayload.json().errors[0].path).toMatch(/^body\.payload\.location/);
    const types = await call(ctx, 'GET', '/v1/commands/types', { as: a.owner });
    expect(types.json().types).toEqual(expect.arrayContaining(['PropertyPinRelocated', 'EstimateLineItemQuantityChanged', 'EstimateRepriced']));
  });

  it('enforces permission (403) and tenancy (404) before reading anything', async () => {
    const { a, property } = await setup();
    const b = await createCompany(ctx);
    const body = envelope(property.id, property.revision);
    const denied = await call(ctx, 'POST', '/v1/commands', { as: a.as('read_only'), body, headers: { 'idempotency-key': body.command_id } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('forbidden');
    const foreign = await call(ctx, 'POST', '/v1/commands', { as: b.owner, body, headers: { 'idempotency-key': body.command_id } });
    expect(foreign.statusCode).toBe(404);
    const ok = await call(ctx, 'POST', '/v1/commands', { as: a.owner, body, headers: { 'idempotency-key': body.command_id } });
    expect(ok.statusCode).toBe(201);
    // Another company cannot read the receipt either.
    expect((await call(ctx, 'GET', `/v1/commands/${body.command_id}`, { as: b.owner })).statusCode).toBe(404);
    expect(await countRows(ctx, 'command_receipts', b.orgId)).toBe(0);
  });

  it('typed resource endpoints share the pipeline (receipt + idempotent replay)', async () => {
    const { a, property } = await setup();
    const key = randomUUID();
    const first = await call(ctx, 'POST', `/v1/properties/${property.id}/pin`, { as: a.owner, body: { expectedRevision: property.revision, location: pin(0.0105, 0.0105) }, headers: { 'idempotency-key': key } });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().receipt.command_id).toBe(key);
    const again = await call(ctx, 'POST', `/v1/properties/${property.id}/pin`, { as: a.owner, body: { expectedRevision: property.revision, location: pin(0.0105, 0.0105) }, headers: { 'idempotency-key': key } });
    expect(again.statusCode).toBe(200);
    expect(again.json().receipt).toEqual(first.json().receipt);
    const lookup = await call(ctx, 'GET', `/v1/commands/${key}`, { as: a.owner });
    expect(lookup.json()).toEqual(first.json().receipt);
  });
});
