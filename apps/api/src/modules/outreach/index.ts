// Bid outreach routes (/v1/outreach/*): today's Texas companies, contact details, emails sent from
// the member's own connected mailbox, call notes, and the replies and offers read back from it.
// Reads need job:read; anything that changes data or sends email needs job:write.
import { and, desc, eq, gte, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { MailAddressSchema } from '@fieldline/contracts';
import { z } from 'zod';
import { outreachCompanies, outreachMessages, outreachSettings } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { MailerError } from '../../services/mailer-client';
import { OUTREACH_TRADES, TEXAS_CITIES, TRADE_KEYS } from './lib';
import {
  getCompany,
  getSettings,
  lookupCompanyEmail,
  OutreachSetupError,
  queueEmails,
  refreshCompanies,
  sendQueued,
  syncReplies,
  todayInTexas,
  type CompanyRow,
  type Run,
  type SettingsRow,
} from './service';

const STATUSES = [
  'new',
  'contacted',
  'replied',
  'interested',
  'offer',
  'declined',
  'do_not_contact',
] as const;
const CALL_OUTCOMES = [
  'no_answer',
  'voicemail',
  'interested',
  'not_interested',
  'call_back',
  'do_not_call',
] as const;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

const Settings = z.object({
  autoRefresh: z.boolean(),
  businessName: z.string(),
  businessAddress: z.string(),
  businessPhone: z.string(),
  trades: z.array(z.string()),
  cities: z.array(z.string()),
  dailyLeadTarget: z.number(),
  dailyEmailLimit: z.number(),
  subjectTemplate: z.string(),
  bodyTemplate: z.string(),
  lastRefreshAt: z.string().nullable(),
  lastRefreshMessage: z.string(),
  lastSyncAt: z.string().nullable(),
  lastSyncMessage: z.string(),
  revision: z.number(),
});
const toSettings = (s: SettingsRow) => ({
  autoRefresh: s.autoRefresh,
  businessName: s.businessName,
  businessAddress: s.businessAddress,
  businessPhone: s.businessPhone,
  trades: s.trades,
  cities: s.cities,
  dailyLeadTarget: s.dailyLeadTarget,
  dailyEmailLimit: s.dailyEmailLimit,
  subjectTemplate: s.subjectTemplate,
  bodyTemplate: s.bodyTemplate,
  lastRefreshAt: iso(s.lastRefreshAt),
  lastRefreshMessage: s.lastRefreshMessage,
  lastSyncAt: iso(s.lastSyncAt),
  lastSyncMessage: s.lastSyncMessage,
  revision: s.revision,
});

const Company = z.object({
  id: z.string(),
  source: z.string(),
  name: z.string(),
  trade: z.string(),
  city: z.string(),
  state: z.string(),
  address: z.string(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  email: z.string().nullable(),
  emailSource: z.string().nullable(),
  status: z.string(),
  foundOn: z.string(),
  lastContactedAt: z.string().nullable(),
  lastReplyAt: z.string().nullable(),
  offerAmountMinor: z.number().nullable(),
  notes: z.string(),
  revision: z.number(),
});
const toCompany = (c: CompanyRow) => ({
  id: c.id,
  source: c.source,
  name: c.name,
  trade: c.trade,
  city: c.city,
  state: c.state,
  address: c.address,
  phone: c.phone,
  website: c.website,
  email: c.email,
  emailSource: c.emailSource,
  status: c.status,
  foundOn: c.foundOn,
  lastContactedAt: iso(c.lastContactedAt),
  lastReplyAt: iso(c.lastReplyAt),
  offerAmountMinor: c.offerAmountMinor,
  notes: c.notes,
  revision: c.revision,
});

const Message = z.object({
  id: z.string(),
  companyId: z.string(),
  companyName: z.string(),
  companyPhone: z.string().nullable(),
  direction: z.string(),
  status: z.string(),
  subject: z.string(),
  body: z.string(),
  toEmail: z.string().nullable(),
  fromEmail: z.string().nullable(),
  webLink: z.string().nullable(),
  classification: z.string().nullable(),
  amountMinor: z.number().nullable(),
  error: z.string().nullable(),
  handled: z.boolean(),
  at: z.string(),
});

const Overview = z.object({
  settings: Settings,
  placesConfigured: z.boolean(),
  mailerAvailable: z.boolean(),
  mailbox: z.object({ connected: z.boolean(), address: z.string().nullable() }),
  trades: z.array(z.object({ id: z.string(), label: z.string() })),
  defaultCities: z.array(z.string()),
  stats: z.object({
    today: z.number(),
    total: z.number(),
    withEmail: z.number(),
    queued: z.number(),
    sentToday: z.number(),
    unhandledReplies: z.number(),
    offers: z.number(),
    interested: z.number(),
  }),
});

const Line = (max: number) => z.string().trim().max(max);
const SettingsBody = z.object({
  autoRefresh: z.boolean(),
  businessName: Line(160),
  businessAddress: Line(300),
  businessPhone: Line(40),
  trades: z
    .array(z.enum(TRADE_KEYS as [string, ...string[]]))
    .min(1)
    .max(TRADE_KEYS.length),
  cities: z.array(Line(80).min(2)).max(60),
  dailyLeadTarget: z.number().int().min(0).max(100),
  dailyEmailLimit: z.number().int().min(0).max(200),
  subjectTemplate: Line(250).min(1),
  bodyTemplate: z.string().trim().min(20).max(8000),
});

const Params = z.object({ id: z.uuid() });
const Ok = z.object({ message: z.string() });

const outreachModule: FastifyPluginAsyncZod = async (app) => {
  const runFor =
    (request: Parameters<typeof tenantTx>[0]): Run =>
    (fn) =>
      tenantTx(request, fn);

  app.get(
    '/outreach/overview',
    {
      config: { permission: 'job:read', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['outreach'],
        summary: 'Outreach settings, mailbox and today’s numbers',
        response: { 200: Overview },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const run = runFor(request);
      const settings = await getSettings(run, org.orgId);
      const today = todayInTexas();
      const stats = await run(async (tx) => {
        const [c] = await tx
          .select({
            today: sql<number>`count(*) filter (where ${outreachCompanies.foundOn} = ${today})::int`,
            total: sql<number>`count(*)::int`,
            withEmail: sql<number>`count(*) filter (where ${outreachCompanies.email} is not null)::int`,
            offers: sql<number>`count(*) filter (where ${outreachCompanies.status} = 'offer')::int`,
            interested: sql<number>`count(*) filter (where ${outreachCompanies.status} = 'interested')::int`,
          })
          .from(outreachCompanies)
          .where(eq(outreachCompanies.orgId, org.orgId));
        const [m] = await tx
          .select({
            queued: sql<number>`count(*) filter (where ${outreachMessages.direction} = 'out' and ${outreachMessages.status} = 'queued')::int`,
            sentToday: sql<number>`count(*) filter (where ${outreachMessages.direction} = 'out' and ${outreachMessages.status} = 'sent' and ${outreachMessages.sentAt} >= now() - interval '1 day')::int`,
            unhandled: sql<number>`count(*) filter (where ${outreachMessages.direction} = 'in' and not ${outreachMessages.handled})::int`,
          })
          .from(outreachMessages)
          .where(eq(outreachMessages.orgId, org.orgId));
        return {
          today: c?.today ?? 0,
          total: c?.total ?? 0,
          withEmail: c?.withEmail ?? 0,
          offers: c?.offers ?? 0,
          interested: c?.interested ?? 0,
          queued: m?.queued ?? 0,
          sentToday: m?.sentToday ?? 0,
          unhandledReplies: m?.unhandled ?? 0,
        };
      });
      let mailbox = { connected: false, address: null as string | null };
      try {
        const list = await app.mailer.list({ orgId: org.orgId, userId: org.userId });
        const def = list.items.find((i) => i.id === list.defaultMailboxId) ?? list.items[0];
        mailbox = { connected: !!def, address: def?.email ?? null };
      } catch {
        // mail server asleep or off: shown as not connected
      }
      return {
        settings: toSettings(settings),
        placesConfigured: !!app.config.outreach.placesKey,
        mailerAvailable: app.mailer.available,
        mailbox,
        trades: TRADE_KEYS.map((id) => ({ id, label: OUTREACH_TRADES[id].label })),
        defaultCities: TEXAS_CITIES,
        stats,
      };
    },
  );

  app.put(
    '/outreach/settings',
    {
      config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['outreach'],
        summary: 'Save outreach settings',
        body: SettingsBody,
        response: { 200: Settings },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const run = runFor(request);
      await getSettings(run, org.orgId);
      const b = request.body;
      const row = await run(async (tx) => {
        const [r] = await tx
          .update(outreachSettings)
          .set({
            ...b,
            cities: [...new Set(b.cities)],
            senderUserId: org.userId,
            revision: sql`${outreachSettings.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(outreachSettings.orgId, org.orgId))
          .returning();
        return r!;
      });
      return toSettings(row);
    },
  );

  app.get(
    '/outreach/companies',
    {
      config: { permission: 'job:read', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['outreach'],
        summary: 'Companies: today’s list or everything, with filters',
        querystring: z.object({
          view: z.enum(['today', 'all']).default('today'),
          status: z.enum(STATUSES).optional(),
          trade: z.string().max(40).optional(),
          q: z.string().trim().max(80).default(''),
          limit: z.coerce.number().int().min(1).max(200).default(100),
          offset: z.coerce.number().int().min(0).max(100_000).default(0),
        }),
        response: { 200: z.object({ items: z.array(Company), total: z.number() }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { view, status, trade, q, limit, offset } = request.query;
      const where: SQL[] = [eq(outreachCompanies.orgId, org.orgId)];
      if (view === 'today') where.push(eq(outreachCompanies.foundOn, todayInTexas()));
      if (status) where.push(eq(outreachCompanies.status, status));
      if (trade) where.push(eq(outreachCompanies.trade, trade));
      if (q) {
        const like = `%${q.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
        where.push(
          or(
            ilike(outreachCompanies.name, like),
            ilike(outreachCompanies.city, like),
            ilike(outreachCompanies.email, like),
          )!,
        );
      }
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(outreachCompanies)
          .where(and(...where))
          .orderBy(desc(outreachCompanies.foundOn), outreachCompanies.name)
          .limit(limit)
          .offset(offset);
        const [n] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(outreachCompanies)
          .where(and(...where));
        return { items: rows.map(toCompany), total: n?.n ?? 0 };
      });
    },
  );

  app.post(
    '/outreach/companies',
    {
      config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['outreach'],
        summary: 'Add a company by hand',
        body: z.object({
          name: Line(200).min(2),
          trade: z.enum(TRADE_KEYS as [string, ...string[]]),
          city: Line(100).default(''),
          phone: Line(40).optional(),
          email: MailAddressSchema.optional(),
          website: z.url().max(500).optional(),
          notes: Line(4000).default(''),
        }),
        response: { 201: Company },
      },
    },
    async (request, reply) => {
      const org = requireOrg(request);
      const b = request.body;
      const row = await tenantTx(request, async (tx) => {
        const [r] = await tx
          .insert(outreachCompanies)
          .values({
            orgId: org.orgId,
            source: 'manual',
            sourceId: null,
            name: b.name,
            trade: b.trade,
            city: b.city,
            phone: b.phone || null,
            email: b.email?.toLowerCase() || null,
            emailSource: b.email ? 'manual' : null,
            website: b.website || null,
            notes: b.notes,
            foundOn: todayInTexas(),
          })
          .returning();
        return r!;
      });
      reply.code(201);
      return toCompany(row);
    },
  );

  app.patch(
    '/outreach/companies/:id',
    {
      config: { permission: 'job:write', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['outreach'],
        summary: 'Update a company’s email, phone, status or notes',
        params: Params,
        body: z.object({
          email: z.union([MailAddressSchema, z.literal('')]).optional(),
          phone: Line(40).optional(),
          status: z.enum(STATUSES).optional(),
          notes: Line(4000).optional(),
        }),
        response: { 200: Company },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const b = request.body;
      const row = await tenantTx(request, async (tx) => {
        const [r] = await tx
          .update(outreachCompanies)
          .set({
            ...(b.email !== undefined && {
              email: b.email ? b.email.toLowerCase() : null,
              emailSource: b.email ? 'manual' : null,
            }),
            ...(b.phone !== undefined && { phone: b.phone || null }),
            ...(b.status !== undefined && { status: b.status }),
            ...(b.notes !== undefined && { notes: b.notes }),
            revision: sql`${outreachCompanies.revision} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(outreachCompanies.orgId, org.orgId),
              eq(outreachCompanies.id, request.params.id),
            ),
          )
          .returning();
        return r;
      });
      if (!row) throw problem('not_found', 'Company not found.');
      return toCompany(row);
    },
  );

  app.delete(
    '/outreach/companies/:id',
    {
      config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['outreach'],
        summary: 'Remove a company from the list',
        params: Params,
        response: { 200: Ok },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const gone = await tenantTx(request, (tx) =>
        tx
          .delete(outreachCompanies)
          .where(
            and(
              eq(outreachCompanies.orgId, org.orgId),
              eq(outreachCompanies.id, request.params.id),
            ),
          )
          .returning({ id: outreachCompanies.id }),
      );
      if (!gone.length) throw problem('not_found', 'Company not found.');
      return { message: 'Company removed.' };
    },
  );

  app.post(
    '/outreach/companies/:id/find-email',
    {
      config: { permission: 'job:write', rateLimit: { max: 20, timeWindow: '1 minute' } },
      schema: {
        tags: ['outreach'],
        summary: 'Look for a contact email on the company website',
        params: Params,
        response: { 200: Company },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const row = await lookupCompanyEmail(runFor(request), org.orgId, request.params.id);
      if (!row) throw problem('not_found', 'Company not found.');
      return toCompany(row);
    },
  );

  app.post(
    '/outreach/companies/:id/calls',
    {
      config: { permission: 'job:write', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['outreach'],
        summary: 'Log a phone call and its outcome',
        params: Params,
        body: z.object({ outcome: z.enum(CALL_OUTCOMES), notes: Line(2000).default('') }),
        response: { 200: Company },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { outcome, notes } = request.body;
      const company = await getCompany(runFor(request), org.orgId, request.params.id);
      if (!company) throw problem('not_found', 'Company not found.');
      const nextStatus =
        outcome === 'do_not_call'
          ? 'do_not_contact'
          : outcome === 'interested'
            ? company.status === 'offer'
              ? 'offer'
              : 'interested'
            : outcome === 'not_interested'
              ? 'declined'
              : company.status === 'new'
                ? 'contacted'
                : company.status;
      const row = await tenantTx(request, async (tx) => {
        const now = new Date();
        await tx.insert(outreachMessages).values({
          orgId: org.orgId,
          companyId: company.id,
          direction: 'call',
          status: 'logged',
          subject: outcome.replace(/_/g, ' '),
          body: notes,
          classification: outcome,
          senderUserId: org.userId,
          handled: true,
          sentAt: now,
        });
        const [r] = await tx
          .update(outreachCompanies)
          .set({ status: nextStatus, lastContactedAt: now, updatedAt: now })
          .where(and(eq(outreachCompanies.orgId, org.orgId), eq(outreachCompanies.id, company.id)))
          .returning();
        return r!;
      });
      return toCompany(row);
    },
  );

  app.post(
    '/outreach/refresh',
    {
      config: { permission: 'job:write', rateLimit: { max: 6, timeWindow: '10 minutes' } },
      schema: {
        tags: ['outreach'],
        summary: 'Find new Texas companies now',
        response: {
          200: z.object({
            added: z.number(),
            searched: z.number(),
            emailsFound: z.number(),
            message: z.string(),
          }),
        },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      return refreshCompanies(runFor(request), org.orgId, app.config.outreach.placesKey);
    },
  );

  app.post(
    '/outreach/send',
    {
      config: { permission: 'job:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['outreach'],
        summary: 'Email the selected companies from your connected mailbox',
        body: z.object({
          companyIds: z.array(z.uuid()).min(1).max(100),
          subject: Line(250).optional(),
          body: z.string().trim().max(8000).optional(),
          resend: z.boolean().default(false),
        }),
        response: {
          200: z.object({
            queued: z.number(),
            sent: z.number(),
            failed: z.number(),
            remaining: z.number(),
            skipped: z.array(z.object({ companyId: z.string(), reason: z.string() })),
            message: z.string(),
          }),
        },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const run = runFor(request);
      const b = request.body;
      let queued;
      try {
        queued = await queueEmails(
          run,
          org.orgId,
          org.userId,
          b.companyIds,
          { subject: b.subject, body: b.body },
          b.resend,
        );
      } catch (error) {
        if (error instanceof OutreachSetupError) throw problem('conflict', error.message);
        throw error;
      }
      if (!app.mailer.available) {
        return {
          ...queued,
          sent: 0,
          failed: 0,
          remaining: queued.queued,
          message: 'Emails are queued, but the mail server is not set up on this server yet.',
        };
      }
      const sent = await sendQueued(run, org.orgId, app.mailer, 10);
      return { ...queued, ...sent };
    },
  );

  app.post(
    '/outreach/sync',
    {
      config: { permission: 'job:write', rateLimit: { max: 10, timeWindow: '5 minutes' } },
      schema: {
        tags: ['outreach'],
        summary: 'Send anything queued and check your mailbox for replies now',
        response: {
          200: z.object({ sent: z.number(), newReplies: z.number(), message: z.string() }),
        },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const run = runFor(request);
      if (!app.mailer.available)
        throw problem('conflict', 'The mail server is not set up on this server yet.');
      const sent = await sendQueued(run, org.orgId, app.mailer, 10).catch((e: unknown) => ({
        sent: 0,
        message: e instanceof MailerError ? e.message : 'Sending failed.',
      }));
      const sync = await syncReplies(run, org.orgId, app.mailer);
      return {
        sent: sent.sent,
        newReplies: sync.newReplies,
        message: sent.sent ? `Sent ${sent.sent}. ${sync.message}` : sync.message,
      };
    },
  );

  app.get(
    '/outreach/messages',
    {
      config: { permission: 'job:read', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['outreach'],
        summary: 'Replies and offers, or the history of one company',
        querystring: z.object({
          direction: z.enum(['in', 'out', 'call', 'all']).default('in'),
          companyId: z.uuid().optional(),
          unhandled: z.enum(['true', 'false']).default('false'),
          days: z.coerce.number().int().min(1).max(365).default(60),
        }),
        response: { 200: z.object({ items: z.array(Message) }) },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const { direction, companyId, unhandled, days } = request.query;
      const where: SQL[] = [
        eq(outreachMessages.orgId, org.orgId),
        gte(outreachMessages.createdAt, new Date(Date.now() - days * 86_400_000)),
      ];
      if (direction !== 'all') where.push(eq(outreachMessages.direction, direction));
      if (companyId) where.push(eq(outreachMessages.companyId, companyId));
      if (unhandled === 'true') where.push(eq(outreachMessages.handled, false));
      const rows = await tenantTx(request, (tx) =>
        tx
          .select({
            m: outreachMessages,
            name: outreachCompanies.name,
            phone: outreachCompanies.phone,
          })
          .from(outreachMessages)
          .innerJoin(
            outreachCompanies,
            and(
              eq(outreachCompanies.orgId, outreachMessages.orgId),
              eq(outreachCompanies.id, outreachMessages.companyId),
            ),
          )
          .where(and(...where))
          .orderBy(
            desc(
              sql`coalesce(${outreachMessages.receivedAt}, ${outreachMessages.sentAt}, ${outreachMessages.createdAt})`,
            ),
          )
          .limit(200),
      );
      return {
        items: rows.map(({ m, name, phone }) => ({
          id: m.id,
          companyId: m.companyId,
          companyName: name,
          companyPhone: phone,
          direction: m.direction,
          status: m.status,
          subject: m.subject,
          body: m.body,
          toEmail: m.toEmail,
          fromEmail: m.fromEmail,
          webLink: m.webLink,
          classification: m.classification,
          amountMinor: m.amountMinor,
          error: m.error,
          handled: m.handled,
          at: (m.receivedAt ?? m.sentAt ?? m.createdAt).toISOString(),
        })),
      };
    },
  );

  app.post(
    '/outreach/messages/:id/handled',
    {
      config: { permission: 'job:write', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['outreach'],
        summary: 'Mark a reply as dealt with (or not)',
        params: Params,
        body: z.object({ handled: z.boolean() }),
        response: { 200: Ok },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .update(outreachMessages)
          .set({ handled: request.body.handled, updatedAt: new Date() })
          .where(
            and(eq(outreachMessages.orgId, org.orgId), eq(outreachMessages.id, request.params.id)),
          )
          .returning({ id: outreachMessages.id }),
      );
      if (!rows.length) throw problem('not_found', 'Message not found.');
      return { message: request.body.handled ? 'Marked as handled.' : 'Marked as open.' };
    },
  );

  app.post(
    '/outreach/messages/:id/cancel',
    {
      config: { permission: 'job:write', rateLimit: { max: 120, timeWindow: '1 minute' } },
      schema: {
        tags: ['outreach'],
        summary: 'Cancel a queued email',
        params: Params,
        response: { 200: Ok },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const rows = await tenantTx(request, (tx) =>
        tx
          .delete(outreachMessages)
          .where(
            and(
              eq(outreachMessages.orgId, org.orgId),
              eq(outreachMessages.id, request.params.id),
              inArray(outreachMessages.status, ['queued', 'failed']),
            ),
          )
          .returning({ id: outreachMessages.id }),
      );
      if (!rows.length) throw problem('not_found', 'No queued email with that id.');
      return { message: 'Email removed from the queue.' };
    },
  );
};

export default outreachModule;
