// Bid outreach service, shared by the HTTP routes and the morning worker job. Every query filters
// by orgId explicitly, so it is safe both under tenant RLS and on the worker's platform role.
// Network calls (Google Places, company websites, the mail server) never run inside a transaction.
import { and, desc, eq, gte, inArray, isNotNull, sql } from 'drizzle-orm';
import { outreachCompanies, outreachMessages, outreachSettings, users } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { DEFAULT_LICENSE_COUNTIES, normalizeTdlr, scoreLead, tdlrQuery } from './tdlr';
import { MailerError, type MailerClient } from '../../services/mailer-client';
import {
  classifyReply,
  complianceFooter,
  DEFAULT_BODY,
  DEFAULT_SUBJECT,
  DEFAULT_TRADES,
  findWebsiteEmail,
  normalizeOverpass,
  normalizePlaces,
  OUTREACH_TRADES,
  OVERPASS_URL,
  overpassQuery,
  TEXAS_CITIES,
  renderTemplate,
  searchPlan,
  statusAfterReply,
  type FetchLike,
} from './lib';

export type Run = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;
export type SettingsRow = typeof outreachSettings.$inferSelect;
export type CompanyRow = typeof outreachCompanies.$inferSelect;

export const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';
const PLACES_FIELDS =
  'places.id,places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.businessStatus';
/** Do not email the same company again within this many days unless a person resends by hand. */
export const RECONTACT_DAYS = 14;
const MAX_SEARCHES_PER_REFRESH = 8;
const MAX_EMAIL_LOOKUPS_PER_REFRESH = 20;

export const todayInTexas = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now);

export async function getSettings(run: Run, orgId: string): Promise<SettingsRow> {
  return run(async (tx) => {
    const [row] = await tx
      .select()
      .from(outreachSettings)
      .where(eq(outreachSettings.orgId, orgId))
      .limit(1);
    if (row) return row;
    const [created] = await tx
      .insert(outreachSettings)
      .values({
        orgId,
        trades: DEFAULT_TRADES,
        cities: [],
        subjectTemplate: DEFAULT_SUBJECT,
        bodyTemplate: DEFAULT_BODY,
      })
      .onConflictDoNothing()
      .returning();
    if (created) return created;
    const [again] = await tx
      .select()
      .from(outreachSettings)
      .where(eq(outreachSettings.orgId, orgId))
      .limit(1);
    return again!;
  });
}

async function noteRefresh(run: Run, orgId: string, message: string, cursor?: number) {
  await run((tx) =>
    tx
      .update(outreachSettings)
      .set({
        lastRefreshAt: new Date(),
        lastRefreshMessage: message.slice(0, 500),
        ...(cursor !== undefined && { searchCursor: cursor }),
        updatedAt: new Date(),
      })
      .where(eq(outreachSettings.orgId, orgId)),
  );
}

export interface RefreshResult {
  added: number;
  searched: number;
  emailsFound: number;
  message: string;
}

/** Find new Texas companies for today's list, then look for a published email on their sites. */
export async function refreshCompanies(
  run: Run,
  orgId: string,
  placesKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<RefreshResult> {
  const settings = await getSettings(run, orgId);
  if (!placesKey) return refreshFromOpenStreetMap(run, orgId, settings, fetchImpl);
  const plan = searchPlan(settings.trades, settings.cities);
  const target = settings.dailyLeadTarget;
  const today = todayInTexas();
  let cursor = settings.searchCursor % Math.max(plan.length, 1);
  let added = 0;
  let searched = 0;
  const fresh: { id: string; website: string }[] = [];
  while (added < target && searched < MAX_SEARCHES_PER_REFRESH && plan.length) {
    const step = plan[cursor]!;
    cursor = (cursor + 1) % plan.length;
    searched += 1;
    let res: Response;
    try {
      res = await fetchImpl(PLACES_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': placesKey,
          'X-Goog-FieldMask': PLACES_FIELDS,
        },
        body: JSON.stringify({ textQuery: step.query, regionCode: 'US', pageSize: 20 }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      continue;
    }
    if (res.status === 400 || res.status === 403) {
      const message = `Google Places refused the search (HTTP ${res.status}). Check that the key is valid and the Places API (New) is enabled.`;
      await noteRefresh(run, orgId, message, cursor);
      return { added, searched, emailsFound: 0, message };
    }
    if (!res.ok) continue;
    const found = normalizePlaces(await res.json(), step.city);
    if (!found.length) continue;
    const rows = await run((tx) =>
      tx
        .insert(outreachCompanies)
        .values(
          found.slice(0, target - added).map((c) => ({
            orgId,
            source: 'google_places',
            sourceId: c.sourceId,
            name: c.name,
            trade: step.trade,
            city: c.city,
            address: c.address,
            phone: c.phone,
            website: c.website,
            foundOn: today,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: outreachCompanies.id, website: outreachCompanies.website }),
    );
    added += rows.length;
    for (const r of rows) if (r.website) fresh.push({ id: r.id, website: r.website });
  }
  let emailsFound = 0;
  for (const c of fresh.slice(0, MAX_EMAIL_LOOKUPS_PER_REFRESH)) {
    const email = await findWebsiteEmail(c.website, fetchImpl).catch(() => null);
    if (!email) continue;
    emailsFound += 1;
    await run((tx) =>
      tx
        .update(outreachCompanies)
        .set({ email, emailSource: 'website', updatedAt: new Date() })
        .where(and(eq(outreachCompanies.orgId, orgId), eq(outreachCompanies.id, c.id))),
    );
  }
  const message = `Found ${added} new compan${added === 1 ? 'y' : 'ies'} from ${searched} search${searched === 1 ? '' : 'es'}; ${emailsFound} had a contact email on their website.`;
  await noteRefresh(run, orgId, message, cursor);
  return { added, searched, emailsFound, message };
}

/** Free search: OpenStreetMap (Overpass), one Texas city per step, no key needed. */
async function refreshFromOpenStreetMap(
  run: Run,
  orgId: string,
  settings: SettingsRow,
  fetchImpl: FetchLike,
): Promise<RefreshResult> {
  const cities = settings.cities.length ? settings.cities : TEXAS_CITIES;
  const wanted = new Set(settings.trades);
  const today = todayInTexas();
  let cursor = settings.searchCursor % cities.length;
  let added = 0;
  let searched = 0;
  let emailsFound = 0;
  const fresh: { id: string; website: string }[] = [];
  while (added < settings.dailyLeadTarget && searched < Math.min(6, cities.length)) {
    const city = cities[cursor]!;
    cursor = (cursor + 1) % cities.length;
    searched += 1;
    let res: Response;
    try {
      res = await fetchImpl(OVERPASS_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'FieldPro-Outreach/1.0 (contractor bid outreach)',
        },
        body: new URLSearchParams({ data: overpassQuery(city) }).toString(),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      continue;
    }
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (!res.ok) continue;
    const found = normalizeOverpass(await res.json(), city).filter((c) => wanted.has(c.trade));
    if (!found.length) continue;
    const rows = await run((tx) =>
      tx
        .insert(outreachCompanies)
        .values(
          found.slice(0, settings.dailyLeadTarget - added).map((c) => ({
            orgId,
            source: 'openstreetmap',
            sourceId: c.sourceId,
            name: c.name,
            trade: c.trade,
            city: c.city,
            address: c.address,
            phone: c.phone,
            website: c.website,
            email: c.email,
            emailSource: c.email ? 'website' : null,
            foundOn: today,
          })),
        )
        .onConflictDoNothing()
        .returning({
          id: outreachCompanies.id,
          website: outreachCompanies.website,
          email: outreachCompanies.email,
        }),
    );
    added += rows.length;
    for (const r of rows) {
      if (r.email) emailsFound += 1;
      else if (r.website) fresh.push({ id: r.id, website: r.website });
    }
  }
  for (const c of fresh.slice(0, MAX_EMAIL_LOOKUPS_PER_REFRESH)) {
    const email = await findWebsiteEmail(c.website, fetchImpl).catch(() => null);
    if (!email) continue;
    emailsFound += 1;
    await run((tx) =>
      tx
        .update(outreachCompanies)
        .set({ email, emailSource: 'website', updatedAt: new Date() })
        .where(and(eq(outreachCompanies.orgId, orgId), eq(outreachCompanies.id, c.id))),
    );
  }
  const message = `Found ${added} new compan${added === 1 ? 'y' : 'ies'} in ${searched} Texas cit${searched === 1 ? 'y' : 'ies'} from OpenStreetMap (free, © OpenStreetMap contributors); ${emailsFound} with an email. A Google Places key finds more.`;
  await noteRefresh(run, orgId, message, cursor);
  return { added, searched, emailsFound, message };
}

export interface LicenseImportResult {
  found: number;
  added: number;
  updated: number;
  message: string;
}

/** Pull contractor licenses expiring soon from TDLR's public file into the company list. */
export async function importLicenseLeads(
  run: Run,
  orgId: string,
  input: { types?: string[]; counties?: string[]; days?: number; limit?: number },
  fetchImpl: FetchLike = fetch,
): Promise<LicenseImportResult> {
  const settings = await getSettings(run, orgId);
  const types = input.types ?? settings.licenseTypes;
  const counties =
    input.counties ??
    (settings.licenseCounties.length ? settings.licenseCounties : DEFAULT_LICENSE_COUNTIES);
  const days = input.days ?? settings.licenseDays;
  const limit = Math.min(input.limit ?? 2000, 5000);
  const leads = [];
  for (let offset = 0; offset < limit; offset += 1000) {
    const res = await fetchImpl(
      tdlrQuery({ types, counties, days, limit: Math.min(1000, limit - offset), offset }),
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) throw new Error(`The Texas license file did not answer (HTTP ${res.status}).`);
    const rows = (await res.json()) as unknown[];
    leads.push(...normalizeTdlr(rows, days));
    if (!Array.isArray(rows) || rows.length < 1000) break;
  }
  const today = todayInTexas();
  let added = 0;
  let updated = 0;
  for (let i = 0; i < leads.length; i += 200) {
    const chunk = leads.slice(i, i + 200);
    const rows = await run((tx) =>
      tx
        .insert(outreachCompanies)
        .values(
          chunk.map((l) => ({
            orgId,
            source: 'tdlr',
            sourceId: l.sourceId,
            name: l.name.slice(0, 200),
            trade: 'licensed_contractor',
            city: l.city,
            address: l.address,
            phone: l.phone,
            ownerName: l.ownerName,
            county: l.county,
            licenseType: l.licenseType,
            licenseNumber: l.licenseNumber,
            licenseExpiresOn: l.expiresOn,
            score: scoreLead(l, days),
            foundOn: today,
          })),
        )
        .onConflictDoUpdate({
          target: [outreachCompanies.orgId, outreachCompanies.source, outreachCompanies.sourceId],
          set: {
            licenseExpiresOn: sql`excluded.license_expires_on`,
            score: sql`excluded.score`,
            phone: sql`coalesce(${outreachCompanies.phone}, excluded.phone)`,
            updatedAt: new Date(),
          },
        })
        .returning({ inserted: sql<boolean>`(xmax = 0)` }),
    );
    for (const r of rows) {
      if (r.inserted) added += 1;
      else updated += 1;
    }
  }
  const message = `Texas license file: ${leads.length} contractor licenses expire in the next ${days} days in ${counties.length ? counties.join(', ') : 'all counties'}; ${added} new, ${updated} already on your list.`;
  return { found: leads.length, added, updated, message };
}

export async function lookupCompanyEmail(
  run: Run,
  orgId: string,
  companyId: string,
  fetchImpl: FetchLike = fetch,
): Promise<CompanyRow | null> {
  const company = await getCompany(run, orgId, companyId);
  if (!company?.website) return company;
  const email = await findWebsiteEmail(company.website, fetchImpl).catch(() => null);
  if (!email) return company;
  return run(async (tx) => {
    const [row] = await tx
      .update(outreachCompanies)
      .set({ email, emailSource: 'website', updatedAt: new Date() })
      .where(and(eq(outreachCompanies.orgId, orgId), eq(outreachCompanies.id, companyId)))
      .returning();
    return row ?? null;
  });
}

export async function getCompany(run: Run, orgId: string, id: string): Promise<CompanyRow | null> {
  return run(async (tx) => {
    const [row] = await tx
      .select()
      .from(outreachCompanies)
      .where(and(eq(outreachCompanies.orgId, orgId), eq(outreachCompanies.id, id)))
      .limit(1);
    return row ?? null;
  });
}

export interface QueueResult {
  queued: number;
  skipped: { companyId: string; reason: string }[];
}

/** Write one personal email per company into the send queue. Nothing goes out without a footer. */
export async function queueEmails(
  run: Run,
  orgId: string,
  senderUserId: string,
  companyIds: string[],
  override: { subject?: string | undefined; body?: string | undefined },
  force = false,
): Promise<QueueResult> {
  const settings = await getSettings(run, orgId);
  if (!settings.businessName.trim() || !settings.businessAddress.trim()) {
    throw new OutreachSetupError(
      'Add your company name and mailing address in Outreach settings first. US law (CAN-SPAM) requires both in business emails.',
    );
  }
  return run(async (tx) => {
    const [sender] = await tx
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, senderUserId))
      .limit(1);
    const companies = await tx
      .select()
      .from(outreachCompanies)
      .where(and(eq(outreachCompanies.orgId, orgId), inArray(outreachCompanies.id, companyIds)));
    const pending = await tx
      .select({ companyId: outreachMessages.companyId })
      .from(outreachMessages)
      .where(
        and(
          eq(outreachMessages.orgId, orgId),
          eq(outreachMessages.direction, 'out'),
          eq(outreachMessages.status, 'queued'),
          inArray(outreachMessages.companyId, companyIds),
        ),
      );
    const alreadyQueued = new Set(pending.map((p) => p.companyId));
    const recent = Date.now() - RECONTACT_DAYS * 86_400_000;
    const skipped: QueueResult['skipped'] = [];
    const values: (typeof outreachMessages.$inferInsert)[] = [];
    for (const c of companies) {
      if (!c.email) skipped.push({ companyId: c.id, reason: 'No email address yet.' });
      else if (c.status === 'do_not_contact')
        skipped.push({ companyId: c.id, reason: 'Asked not to be contacted.' });
      else if (alreadyQueued.has(c.id))
        skipped.push({ companyId: c.id, reason: 'Already queued.' });
      else if (!force && c.lastContactedAt && c.lastContactedAt.getTime() > recent)
        skipped.push({ companyId: c.id, reason: `Emailed in the last ${RECONTACT_DAYS} days.` });
      else {
        const vars = {
          company: c.name,
          city: c.city,
          trade: OUTREACH_TRADES[c.trade as keyof typeof OUTREACH_TRADES]?.label ?? c.trade,
          myCompany: settings.businessName,
          myPhone: settings.businessPhone,
          sender: sender?.name ?? settings.businessName,
        };
        values.push({
          orgId,
          companyId: c.id,
          direction: 'out',
          status: 'queued',
          subject: renderTemplate(override.subject || settings.subjectTemplate, vars).slice(0, 250),
          body: (
            renderTemplate(override.body || settings.bodyTemplate, vars) +
            complianceFooter(settings.businessName, settings.businessAddress)
          ).slice(0, 12_000),
          toEmail: c.email,
          senderUserId,
        });
      }
    }
    for (const id of companyIds)
      if (!companies.some((c) => c.id === id))
        skipped.push({ companyId: id, reason: 'Not found.' });
    if (values.length) await tx.insert(outreachMessages).values(values);
    return { queued: values.length, skipped };
  });
}

export class OutreachSetupError extends Error {}

export interface SendResult {
  sent: number;
  failed: number;
  remaining: number;
  message: string;
}

/** Send queued emails through each sender's connected mailbox, up to the daily limit. */
export async function sendQueued(
  run: Run,
  orgId: string,
  mailer: MailerClient,
  max = 10,
): Promise<SendResult> {
  const settings = await getSettings(run, orgId);
  const { sentToday, queue } = await run(async (tx) => {
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(outreachMessages)
      .where(
        and(
          eq(outreachMessages.orgId, orgId),
          eq(outreachMessages.direction, 'out'),
          eq(outreachMessages.status, 'sent'),
          gte(outreachMessages.sentAt, new Date(Date.now() - 86_400_000)),
        ),
      );
    const queue = await tx
      .select()
      .from(outreachMessages)
      .where(
        and(
          eq(outreachMessages.orgId, orgId),
          eq(outreachMessages.direction, 'out'),
          eq(outreachMessages.status, 'queued'),
        ),
      )
      .orderBy(outreachMessages.createdAt)
      .limit(max);
    return { sentToday: count?.n ?? 0, queue };
  });
  const room = Math.max(0, settings.dailyEmailLimit - sentToday);
  let sent = 0;
  let failed = 0;
  let stop = '';
  for (const msg of queue.slice(0, room)) {
    if (!msg.toEmail || !msg.senderUserId) continue;
    try {
      const result = await mailer.send(
        { orgId, userId: msg.senderUserId },
        {
          mailbox: null,
          to: msg.toEmail,
          subject: msg.subject,
          text: msg.body,
          fromName: settings.businessName || undefined,
          attachments: [],
          idempotencyKey: `outreach-${msg.id}`,
        },
      );
      const now = new Date();
      await run(async (tx) => {
        await tx
          .update(outreachMessages)
          .set({ status: 'sent', sentAt: now, fromEmail: result.from, error: null, updatedAt: now })
          .where(and(eq(outreachMessages.orgId, orgId), eq(outreachMessages.id, msg.id)));
        await tx
          .update(outreachCompanies)
          .set({
            lastContactedAt: now,
            status: sql`case when ${outreachCompanies.status} = 'new' then 'contacted' else ${outreachCompanies.status} end`,
            updatedAt: now,
          })
          .where(and(eq(outreachCompanies.orgId, orgId), eq(outreachCompanies.id, msg.companyId)));
      });
      sent += 1;
    } catch (error) {
      const code = error instanceof MailerError ? error.code : 'unknown';
      const text = error instanceof Error ? error.message : 'Send failed.';
      // retry / in_progress stay queued for the next run; everything else is a final failure.
      if (code === 'retry' || code === 'in_progress') {
        stop = text;
        break;
      }
      failed += 1;
      await run((tx) =>
        tx
          .update(outreachMessages)
          .set({ status: 'failed', error: text.slice(0, 500), updatedAt: new Date() })
          .where(and(eq(outreachMessages.orgId, orgId), eq(outreachMessages.id, msg.id))),
      );
      if (code === 'not_connected' || code === 'reconnect_required' || code === 'unavailable') {
        stop = text;
        break;
      }
    }
  }
  const [left] = await run((tx) =>
    tx
      .select({ n: sql<number>`count(*)::int` })
      .from(outreachMessages)
      .where(
        and(
          eq(outreachMessages.orgId, orgId),
          eq(outreachMessages.direction, 'out'),
          eq(outreachMessages.status, 'queued'),
        ),
      ),
  );
  const remaining = left?.n ?? 0;
  const message =
    stop ||
    (room === 0 && remaining
      ? `Daily email limit (${settings.dailyEmailLimit}) reached. ${remaining} will go out tomorrow.`
      : `Sent ${sent}${failed ? `, ${failed} failed` : ''}${remaining ? `, ${remaining} still queued` : ''}.`);
  return { sent, failed, remaining, message };
}

export interface SyncResult {
  checked: number;
  newReplies: number;
  message: string;
}

/** Read replies from contacted companies out of each sender's mailbox and file them. */
export async function syncReplies(
  run: Run,
  orgId: string,
  mailer: MailerClient,
): Promise<SyncResult> {
  const groups = await run(async (tx) => {
    const rows = await tx
      .select({
        email: outreachCompanies.email,
        companyId: outreachCompanies.id,
        status: outreachCompanies.status,
        contactedAt: outreachCompanies.lastContactedAt,
        senderUserId: outreachMessages.senderUserId,
      })
      .from(outreachCompanies)
      .innerJoin(
        outreachMessages,
        and(
          eq(outreachMessages.orgId, outreachCompanies.orgId),
          eq(outreachMessages.companyId, outreachCompanies.id),
          eq(outreachMessages.direction, 'out'),
          eq(outreachMessages.status, 'sent'),
        ),
      )
      .where(
        and(
          eq(outreachCompanies.orgId, orgId),
          isNotNull(outreachCompanies.email),
          isNotNull(outreachCompanies.lastContactedAt),
          gte(outreachCompanies.lastContactedAt, new Date(Date.now() - 60 * 86_400_000)),
        ),
      );
    const bySender = new Map<
      string,
      Map<string, { companyId: string; status: string; since: Date }>
    >();
    for (const r of rows) {
      if (!r.email || !r.senderUserId || !r.contactedAt) continue;
      const map = bySender.get(r.senderUserId) ?? new Map();
      const prior = map.get(r.email.toLowerCase());
      if (!prior || r.contactedAt < prior.since)
        map.set(r.email.toLowerCase(), {
          companyId: r.companyId,
          status: r.status,
          since: r.contactedAt,
        });
      bySender.set(r.senderUserId, map);
    }
    return bySender;
  });
  let checked = 0;
  let newReplies = 0;
  const problems: string[] = [];
  for (const [userId, byEmail] of groups) {
    const emails = [...byEmail.keys()];
    for (let i = 0; i < emails.length; i += 20) {
      const chunk = emails.slice(i, i + 20);
      const since = new Date(
        Math.min(...chunk.map((e) => byEmail.get(e)!.since.getTime())) - 60_000,
      );
      let result;
      try {
        result = await mailer.searchInbox(
          { orgId, userId },
          { mailbox: null, from: chunk, since: since.toISOString(), limit: 50 },
        );
      } catch (error) {
        problems.push(error instanceof Error ? error.message : 'Mailbox check failed.');
        break;
      }
      checked += chunk.length;
      if (result.status === 'read_permission_missing') {
        problems.push(
          `Reconnect ${result.mailboxId.split(':').pop()} in Settings → Connectors and allow reading mail, so replies can be found.`,
        );
        break;
      }
      for (const m of result.messages) {
        const target = byEmail.get(m.from.toLowerCase());
        if (!target) continue;
        const { kind, amountMinor } = classifyReply(m.subject, m.text);
        const inserted = await run(async (tx) => {
          const rows = await tx
            .insert(outreachMessages)
            .values({
              orgId,
              companyId: target.companyId,
              direction: 'in',
              status: 'received',
              subject: m.subject.slice(0, 300),
              body: m.text.slice(0, 12_000),
              fromEmail: m.from,
              externalId: m.id,
              webLink: m.webLink,
              classification: kind,
              amountMinor,
              senderUserId: userId,
              receivedAt: new Date(m.receivedAt),
              handled: kind === 'auto_reply',
            })
            .onConflictDoNothing()
            .returning({ id: outreachMessages.id });
          if (!rows.length) return false;
          const next = statusAfterReply(target.status, kind);
          target.status = next;
          await tx
            .update(outreachCompanies)
            .set({
              status: next,
              lastReplyAt: new Date(m.receivedAt),
              ...(amountMinor !== null && { offerAmountMinor: amountMinor }),
              updatedAt: new Date(),
            })
            .where(
              and(eq(outreachCompanies.orgId, orgId), eq(outreachCompanies.id, target.companyId)),
            );
          return true;
        });
        if (inserted) newReplies += 1;
      }
    }
  }
  const message = problems[0]
    ? problems[0]
    : `Checked ${checked} contacted compan${checked === 1 ? 'y' : 'ies'}; ${newReplies} new repl${newReplies === 1 ? 'y' : 'ies'}.`;
  await run((tx) =>
    tx
      .update(outreachSettings)
      .set({
        lastSyncAt: new Date(),
        lastSyncMessage: message.slice(0, 500),
        updatedAt: new Date(),
      })
      .where(eq(outreachSettings.orgId, orgId)),
  );
  return { checked, newReplies, message };
}

/** Orgs that turned on automatic morning refresh (worker only; platform role). */
export async function autoRefreshOrgs(run: Run): Promise<string[]> {
  return run(async (tx) => {
    const rows = await tx
      .select({ orgId: outreachSettings.orgId })
      .from(outreachSettings)
      .where(eq(outreachSettings.autoRefresh, true))
      .orderBy(desc(outreachSettings.updatedAt))
      .limit(500);
    return rows.map((r) => r.orgId);
  });
}

/** Orgs with queued emails or recent sends (worker only; platform role). */
export async function activeOutreachOrgs(run: Run): Promise<string[]> {
  return run(async (tx) => {
    const rows = await tx
      .selectDistinct({ orgId: outreachMessages.orgId })
      .from(outreachMessages)
      .where(
        and(
          eq(outreachMessages.direction, 'out'),
          gte(outreachMessages.createdAt, new Date(Date.now() - 60 * 86_400_000)),
        ),
      )
      .limit(500);
    return rows.map((r) => r.orgId);
  });
}
