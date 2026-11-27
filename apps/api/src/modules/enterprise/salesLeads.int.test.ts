import { randomUUID } from 'node:crypto';
import { Logger, runOnce } from 'graphile-worker';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import {
  call,
  createCompany,
  createTestContext,
  platformTestUrl,
  type TestContext,
} from '../../../test/helpers';
import { workerConnectionString } from '../../jobs/install';
import { buildTaskList } from '../../jobs/tasks';
import { createMailerClient } from '../../services/mailer-client';

let ctx: TestContext;
const path = '/v1/enterprise/sales/leads';
const revision = (value: number) => ({ 'if-match': '"' + value + '"' });

beforeAll(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  const orgIds = [...ctx.tracked.orgIds];
  if (orgIds.length) {
    await ctx.owner.client.begin(async (tx) => {
      await tx`set local session_replication_role = replica`;
      await tx`delete from enterprise_suite.sales_duplicate_policy_revisions where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_activities where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_leads where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.sales_lead_sources where org_id = any(${orgIds}::uuid[])`;
      await tx`delete from enterprise_suite.settings where org_id = any(${orgIds}::uuid[])`;
    });
  }
  await ctx.cleanup();
});

afterAll(async () => ctx?.close());

it('checks normalized duplicates and records one scoped lead per inbound event', async () => {
  const company = await createCompany(ctx, { roles: ['salesperson', 'estimator'] });
  const another = await createCompany(ctx);
  const rep = company.as('salesperson');
  expect((await call(ctx, 'GET', path, { as: rep })).statusCode).toBe(403);

  for (const tenant of [company, another]) {
    const enabled = await call(ctx, 'PUT', '/v1/enterprise/status', {
      as: tenant.owner,
      body: { enabled: true },
    });
    expect(enabled.statusCode, enabled.body).toBe(200);
  }
  async function source(name: string, as = company.owner, status = 201) {
    const result = await call(ctx, 'POST', path + '/sources', { as, body: { name } });
    expect(result.statusCode, result.body).toBe(status);
    if (status < 400) return result.json().id as string;
    return '';
  }

  const sourceId = await source('Website inquiry');
  expect(await source('website inquiry', company.owner, 200)).toBe(sourceId);
  const referralId = await source('Referral');
  const outsideSourceId = await source('Unrelated company referral', another.owner);
  await source('Unauthorized rep source', rep, 403);
  const community = await call(ctx, 'POST', '/v1/land-management/communities', {
    as: company.owner,
    body: { name: 'Fixture East Village' },
  });
  expect(community.statusCode, community.body).toBe(201);
  const communityId = community.json().id as string;
  const options = await call(ctx, 'GET', path + '/options', { as: rep });
  expect(options.statusCode, options.body).toBe(200);
  expect(options.json().communities).toEqual([{ id: communityId, name: 'Fixture East Village' }]);

  const input = {
    name: 'Website prospect',
    sourceId,
    communityId,
    email: '  BUYER@example.test ',
    phone: '(212) 555-0101',
    contactMethod: 'email',
    consent: { inquiry: { email: 'granted', phone: 'declined' }, marketing: { phone: 'declined' } },
  };
  const preview = (body = input, as = rep) => call(ctx, 'POST', path + '/preview', { as, body });
  expect((await preview({ ...input, sourceId: outsideSourceId })).statusCode).toBe(404);
  expect((await preview(input, another.owner)).statusCode).toBe(404);
  expect((await preview(input, company.as('estimator'))).statusCode).toBe(403);
  expect((await preview({ ...input, phone: '()-- .....' })).statusCode).toBe(400);
  const initial = await preview();
  expect(initial.statusCode, initial.body).toBe(200);
  expect(initial.json()).toMatchObject({
    possibleDuplicate: false,
    duplicateCandidates: [],
    permittedInquiryChannels: ['email'],
    permittedMarketingChannels: [],
  });

  const inboundEventId = 'fixture-web:' + randomUUID();
  const data = {
    ...input,
    inboundEventId,
    clientRequestId: randomUUID(),
    previewFingerprint: initial.json().previewFingerprint,
  };
  const save = (body: object = data, as = rep, expected = 0) =>
    call(ctx, 'POST', path, { as, headers: revision(expected), body });
  expect((await save(data, rep, 1)).statusCode).toBe(412);
  expect((await save(data, company.as('estimator'))).statusCode).toBe(403);
  const attempts = await Promise.all([save(), save({ ...data, clientRequestId: randomUUID() })]);
  expect(attempts.map(({ statusCode }) => statusCode).sort()).toEqual([200, 201]);
  const lead = attempts[0].json();
  expect(attempts[1].json()).toEqual(lead);
  expect(lead).toMatchObject({
    email: 'buyer@example.test',
    phone: '2125550101',
    contactMethod: 'email',
    source: { id: sourceId },
    community: { id: communityId, name: 'Fixture East Village' },
    revision: 1,
    permittedInquiryChannels: ['email'],
    permittedMarketingChannels: [],
  });
  expect((await save({ ...data, name: 'A changed payload' })).statusCode).toBe(409);
  expect((await save(data, company.owner)).statusCode).toBe(409);

  const duplicateInput = {
    ...input,
    name: 'Referral prospect',
    sourceId: referralId,
    email: 'buyer@EXAMPLE.test',
    phone: '212-555-0101',
  };
  const duplicate = await preview(duplicateInput);
  expect(duplicate.statusCode, duplicate.body).toBe(200);
  expect(duplicate.json()).toMatchObject({
    possibleDuplicate: true,
    duplicateCandidates: [{ id: lead.id, name: 'Website prospect' }],
  });
  const second = {
    ...duplicateInput,
    inboundEventId: 'fixture-referral:' + randomUUID(),
    clientRequestId: randomUUID(),
    previewFingerprint: duplicate.json().previewFingerprint,
  };
  expect(
    (await save({ ...second, previewFingerprint: initial.json().previewFingerprint })).statusCode,
  ).toBe(412);
  expect((await save(second)).statusCode).toBe(409);
  const confirmed = await save({ ...second, confirmSeparateLead: true });
  expect(confirmed.statusCode, confirmed.body).toBe(201);
  expect(confirmed.json().possibleDuplicate).toBe(true);

  const firstPage = await call(ctx, 'GET', path + '?limit=1', { as: company.owner });
  expect(firstPage.json()).toMatchObject({
    items: [{ id: confirmed.json().id }],
    nextCursor: expect.any(String),
  });
  const secondPage = await call(
    ctx,
    'GET',
    path + '?limit=1&cursor=' + encodeURIComponent(firstPage.json().nextCursor),
    {
      as: company.owner,
    },
  );
  expect(secondPage.json()).toMatchObject({ items: [{ id: lead.id }], nextCursor: null });
  const foreignList = await call(ctx, 'GET', path, { as: another.owner });
  expect(foreignList.json()).toEqual({ items: [], nextCursor: null });

  const activity = await ctx.owner.client`
    select lead_id, kind from enterprise_suite.sales_lead_activities
    where org_id = ${company.orgId} and lead_id = ${lead.id}`;
  expect(activity).toEqual([{ lead_id: lead.id, kind: 'created' }]);
  const audits = await ctx.owner.client`
    select actor_user_id from public.audit_events
    where org_id = ${company.orgId} and resource_id = ${lead.id} and action = 'sales.lead_created'`;
  expect(audits).toEqual([{ actor_user_id: rep.userId }]);
  const taskList = buildTaskList({
    platformDb: ctx.platformDb.db,
    mail: ctx.mail,
    mailer: createMailerClient(null),
    config: ctx.config,
  });
  const initialMail = ctx.mail.sent.length;
  await runOnce({
    connectionString: workerConnectionString(platformTestUrl()),
    taskList: { 'sales.lead_created': taskList['sales.lead_created']! },
    noHandleSignals: true,
    logger: new Logger(() => () => {}),
  });
  expect(ctx.mail.sent).toHaveLength(initialMail);
  const events = await ctx.owner.client`
    select status from public.domain_events
    where org_id = ${company.orgId} and aggregate_id = ${lead.id} and event_type = 'sales.lead_created'`;
  expect(events).toEqual([{ status: 'dispatched' }]);
  const notifications = await ctx.owner.client`
    select recipient_membership_id, channel, delivery_status from public.notifications
    where org_id = ${company.orgId} and dedupe_key = ${'sales.lead_created:' + lead.id + ':in_app'}`;
  expect(notifications).toEqual([
    { recipient_membership_id: rep.membershipId, channel: 'in_app', delivery_status: 'delivered' },
  ]);
}, 60_000);

it('reviews normalized duplicate candidates and versioned warnings without changing consent', async () => {
  const company = await createCompany(ctx, { roles: ['salesperson'] });
  const other = await createCompany(ctx);
  const owner = company.owner;
  const rep = company.as('salesperson');
  const policy = '/v1/enterprise/sales/duplicate-policy';
  for (const tenant of [company, other]) {
    const result = await call(ctx, 'PUT', '/v1/enterprise/status', {
      as: tenant.owner,
      body: { enabled: true },
    });
    expect(result.statusCode, result.body).toBe(200);
  }
  const source = await call(ctx, 'POST', path + '/sources', {
    as: owner,
    body: { name: 'Policy source' },
  });
  expect(source.statusCode, source.body).toBe(201);
  const input = {
    name: 'Existing contact',
    sourceId: source.json().id,
    email: '  DUPLICATE@EXAMPLE.test ',
    phone: '402-555-0110',
    contactMethod: 'email',
    consent: { inquiry: { email: 'granted' }, marketing: { email: 'declined' } },
  };
  const preview = (body: object = input, as = rep) => call(ctx, 'POST', path + '/preview', { as, body });
  const first = await preview();
  expect(first.statusCode, first.body).toBe(200);
  const save = (body: object) => call(ctx, 'POST', path, { as: rep, headers: revision(0), body });
  const saved = await save({
    ...input,
    clientRequestId: randomUUID(),
    previewFingerprint: first.json().previewFingerprint,
  });
  expect(saved.statusCode, saved.body).toBe(201);
  const incoming = {
    ...input,
    name: 'New inquiry',
    email: 'duplicate@example.test',
    phone: '(402) 555-0110',
    consent: {},
  };
  const highlighted = await preview(incoming);
  expect(highlighted.json().possibleDuplicate).toBe(true);
  const candidateId = saved.json().id as string;
  const compare = (previewFingerprint: string, as = rep) =>
    call(ctx, 'POST', path + '/duplicate-review', {
      as,
      body: { ...incoming, candidateId, previewFingerprint },
    });
  const comparison = await compare(highlighted.json().previewFingerprint);
  expect(comparison.statusCode, comparison.body).toBe(200);
  expect(comparison.json()).toMatchObject({
    existing: {
      id: candidateId,
      name: 'Existing contact',
      consent: { marketing: { email: 'declined' } },
    },
    incoming: { name: 'New inquiry', consent: { marketing: { email: 'not_recorded' } } },
    sharedChannels: ['email', 'phone'],
  });
  expect(comparison.body).not.toMatch(/duplicate@example|402555/);
  expect((await compare(highlighted.json().previewFingerprint, other.owner)).statusCode).toBe(404);
  const original = await call(ctx, 'GET', policy, { as: owner });
  expect(original.json()).toMatchObject({ current: { enabled: true, revision: 0 }, recent: [] });
  const command = {
    enabled: false,
    reason: 'Review a high volume of inbound records.',
    clientRequestId: randomUUID(),
  };
  const update = (body: object = command, base = 0, as = owner) =>
    call(ctx, 'PUT', policy, { as, body, headers: revision(base) });
  expect((await update(command, 0, rep)).statusCode).toBe(403);
  const off = await update();
  expect(off.statusCode, off.body).toBe(200);
  expect(off.json()).toMatchObject({
    enabled: false,
    revision: 1,
    reason: command.reason,
    updatedBy: expect.any(String),
    updatedAt: expect.any(String),
  });
  expect((await update()).json()).toEqual(off.json());
  expect((await update({ ...command, clientRequestId: randomUUID() })).statusCode).toBe(412);
  expect((await compare(highlighted.json().previewFingerprint)).statusCode).toBe(412);
  expect(
    (
      await save({
        ...incoming,
        clientRequestId: randomUUID(),
        previewFingerprint: highlighted.json().previewFingerprint,
      })
    ).statusCode,
  ).toBe(412);
  const unwarned = await preview(incoming);
  expect(unwarned.json()).toMatchObject({
    possibleDuplicate: false,
    duplicateCandidates: [],
    permittedInquiryChannels: [],
    permittedMarketingChannels: [],
  });
  expect((await compare(unwarned.json().previewFingerprint)).statusCode).toBe(404);
  const incomingReceipt = {
    ...incoming,
    inboundEventId: 'policy-' + randomUUID(),
    clientRequestId: randomUUID(),
    previewFingerprint: unwarned.json().previewFingerprint,
  };
  const added = await save(incomingReceipt);
  expect(added.statusCode, added.body).toBe(201);
  expect((await save({ ...incomingReceipt, clientRequestId: randomUUID() })).json()).toEqual(
    added.json(),
  );
  const enabled = await update({ ...command, enabled: true, clientRequestId: randomUUID() }, 1);
  expect(enabled.statusCode, enabled.body).toBe(200);
  expect((await preview(incoming)).json().duplicateCandidates).toHaveLength(2);
  expect((await call(ctx, 'GET', policy, { as: owner })).json()).toMatchObject({
    current: { enabled: true, revision: 2 },
    recent: [
      { enabled: true, revision: 2 },
      { enabled: false, revision: 1 },
    ],
  });
  const prior = await call(ctx, 'GET', path, { as: rep });
  expect(prior.statusCode, prior.body).toBe(200);
  expect(prior.json().items.find((row: { id: string }) => row.id === candidateId)).toMatchObject({
    consent: { inquiry: { email: 'granted' }, marketing: { email: 'declined' } },
  });
}, 60_000);
