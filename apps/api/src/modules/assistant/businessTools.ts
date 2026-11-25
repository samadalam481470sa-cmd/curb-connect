// Read-only AI Search over the company's own business data (roofing, from the
// @colton.ai.dean "AI Agents for Roofing" reel: "how many have signed this month").
//
// HARD RULES — never relax these:
// - Read-only only. No tool here mutates anything: every handler runs one scoped SELECT
//   inside the caller's tenant transaction (RLS + an explicit orgId filter). There is no
//   write, send, change or delete path in this file.
// - Never invent a figure. Every number in an answer comes from a row returned by one of
//   these tools. When a tool finds nothing, its summary says "none recorded" with the scope
//   (company + month); the answer never presents 0 as a computed total without the rows.
// - Pipeline value comes only from quotes/estimates that exist. Funnel leads carry no
//   money of their own, so pipeline_value reports funnel stage counts plus the total of
//   the company's open roof quotes, and says so plainly.
// - "Signed" means a signed contract: the contracts table has signedAt and
//   contractValueMinor, so signedThisMonth counts contracts signed in the month and sums
//   their contract value. It is not inferred from job stages or funnel stages.
// - When no AI is connected the route still returns the direct counts (source
//   'data_only', aiConnected false) — a factual summary of real rows, never a fake answer.
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Tx } from '../../db/runtime';
import {
  contracts,
  estimateRevisions,
  estimates,
  invoices,
  jobs,
  permitFunnelStages,
} from '../../db/schema';
import type { ChatMessage, OpenModelSettings } from '../../services/open-model';
import type { ChatFn } from './assistant';
import { FUNNEL_STAGE_LABEL, FUNNEL_STAGES, type FunnelStage } from '../permitLeads/funnel/stages';
import { customerStageLabel } from '../portal/jobStatus';

export const BUSINESS_TOOL_NAMES = [
  'signed_this_month',
  'open_quotes',
  'pipeline_value',
  'jobs_by_status',
  'outstanding_invoices',
] as const;
export type BusinessToolName = (typeof BUSINESS_TOOL_NAMES)[number];
export const BusinessToolNameSchema = z.enum(BUSINESS_TOOL_NAMES);

export const BUSINESS_TOOL_LABELS: Record<BusinessToolName, string> = {
  signed_this_month: 'Signed this month',
  open_quotes: 'Open roof quotes',
  pipeline_value: 'Pipeline by funnel stage',
  jobs_by_status: 'Jobs by status',
  outstanding_invoices: 'Outstanding invoices',
};

/** Request/response schemas live here, in the module — packages/contracts is untouched. */
export const BusinessSearchRequestSchema = z.object({
  question: z.string().trim().min(2).max(2000),
  /** Month to report on, YYYY-MM. Defaults to the current month. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'month must be YYYY-MM')
    .optional(),
});

export const BusinessToolSourceSchema = z.object({
  tool: BusinessToolNameSchema,
  label: z.string(),
  rowCount: z.number().int().nonnegative(),
  summary: z.string(),
});

export const BusinessSearchResponseSchema = z.object({
  answer: z.string(),
  /** False when no AI is connected: the answer is then the direct counts, not a model summary. */
  aiConnected: z.boolean(),
  source: z.enum(['home_server', 'backup_model', 'data_only']),
  model: z.string(),
  disclaimer: z.string(),
  /** Which tools ran and what each found, so the UI can show "from your data" provenance. */
  sources: z.array(BusinessToolSourceSchema),
});

export type BusinessSearchRequest = z.infer<typeof BusinessSearchRequestSchema>;
export type BusinessSearchResponse = z.infer<typeof BusinessSearchResponseSchema>;
export type BusinessToolSource = z.infer<typeof BusinessToolSourceSchema>;

export interface BusinessToolResult {
  tool: BusinessToolName;
  label: string;
  /** Rows the tool actually read (capped); the answer may only quote these. */
  rowCount: number;
  /** True when the cap cut rows off — the count is then a lower bound, and the summary says so. */
  truncated: boolean;
  summary: string;
  rows: Record<string, unknown>[];
  /** Total money in minor units, or null when the tool has no money to total. */
  totalMinor: number | null;
  currency: string;
}

export interface MonthRange {
  key: string;
  label: string;
  start: Date;
  end: Date;
}

const MONTH_FORMAT = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** UTC month bounds for an explicit YYYY-MM, or for the current month when omitted. */
export function monthRange(month: string | undefined, now = new Date()): MonthRange {
  const key = month ?? `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const [year, monthNumber] = key.split('-').map(Number);
  const start = new Date(Date.UTC(year!, monthNumber! - 1, 1));
  const end = new Date(Date.UTC(year!, monthNumber!, 1));
  return { key, label: MONTH_FORMAT.format(start), start, end };
}

export function formatMoney(minor: number | null | undefined, currency = 'USD'): string | null {
  if (minor === null || minor === undefined) return null;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(minor / 100);
}

function moneyOrUnknown(minor: number | null, currency: string): string {
  return formatMoney(minor, currency) ?? 'value not recorded';
}

function capNote(truncated: boolean): string {
  return truncated ? ' (showing the first rows; more records exist)' : '';
}

/**
 * Signed contracts: contracts.signedAt in the month, summed contractValueMinor. "Signed"
 * is the contract table's own signedAt — never inferred from a job or funnel stage.
 */
async function signedThisMonth(tx: Tx, orgId: string, range: MonthRange): Promise<BusinessToolResult> {
  const LIMIT = 200;
  const rows = await tx
    .select({
      number: contracts.number,
      status: contracts.status,
      signedAt: contracts.signedAt,
      contractValueMinor: contracts.contractValueMinor,
      currency: contracts.currency,
    })
    .from(contracts)
    .where(
      and(
        eq(contracts.orgId, orgId),
        gte(contracts.signedAt, range.start),
        lt(contracts.signedAt, range.end),
      ),
    )
    .orderBy(desc(contracts.signedAt))
    .limit(LIMIT);
  const totalMinor = rows.reduce((sum, r) => sum + r.contractValueMinor, 0);
  const currency = rows[0]?.currency ?? 'USD';
  const truncated = rows.length === LIMIT;
  return {
    tool: 'signed_this_month',
    label: BUSINESS_TOOL_LABELS.signed_this_month,
    rowCount: rows.length,
    truncated,
    summary:
      rows.length === 0
        ? `No signed contracts recorded in ${range.label} for your company.`
        : `${rows.length} contract${rows.length === 1 ? '' : 's'} signed in ${range.label}, worth ${moneyOrUnknown(totalMinor, currency)} in total.${capNote(truncated)}`,
    rows: rows.map((r) => ({
      number: r.number,
      status: r.status,
      signedAt: r.signedAt.toISOString(),
      contractValueMinor: r.contractValueMinor,
      currency: r.currency,
    })),
    totalMinor: rows.length === 0 ? null : totalMinor,
    currency,
  };
}

/**
 * Open roof quotes: roof estimates that are not rejected, with their current revision
 * total. A quote with no current revision has no total and is not counted in the value.
 */
async function openQuotes(tx: Tx, orgId: string): Promise<BusinessToolResult> {
  const LIMIT = 100;
  const rows = await tx
    .select({
      number: estimates.number,
      status: estimates.status,
      quoteKind: estimateRevisions.quoteKind,
      totalMinor: estimateRevisions.totalMinor,
      currency: estimateRevisions.currency,
      createdAt: estimates.createdAt,
    })
    .from(estimates)
    .innerJoin(estimateRevisions, eq(estimateRevisions.id, estimates.currentRevisionId))
    .where(
      and(
        eq(estimates.orgId, orgId),
        eq(estimates.productLine, 'roof'),
        ne(estimates.status, 'rejected'),
      ),
    )
    .orderBy(desc(estimates.createdAt))
    .limit(LIMIT);
  const totalMinor = rows.reduce((sum, r) => sum + r.totalMinor, 0);
  const currency = rows[0]?.currency ?? 'USD';
  const truncated = rows.length === LIMIT;
  return {
    tool: 'open_quotes',
    label: BUSINESS_TOOL_LABELS.open_quotes,
    rowCount: rows.length,
    truncated,
    summary:
      rows.length === 0
        ? 'No open roof quotes or estimates recorded for your company.'
        : `${rows.length} open roof quote${rows.length === 1 ? '' : 's'} worth ${moneyOrUnknown(totalMinor, currency)} in total.${capNote(truncated)}`,
    rows: rows.map((r) => ({
      number: r.number,
      status: r.status,
      quoteKind: r.quoteKind,
      totalMinor: r.totalMinor,
      currency: r.currency,
      createdAt: r.createdAt.toISOString(),
    })),
    totalMinor: rows.length === 0 ? null : totalMinor,
    currency,
  };
}

/**
 * Pipeline: funnel leads grouped by stage (new → contacted → quoted / interested → won /
 * lost). Funnel leads carry no money, so the only value reported is the total of the
 * company's open roof quotes (passed in from openQuotes, run once and shared) — never a
 * value invented for a lead.
 */
async function pipelineValue(
  tx: Tx,
  orgId: string,
  openQuotesTotal: { totalMinor: number | null; count: number; currency: string },
): Promise<BusinessToolResult> {
  const LIMIT = 500;
  const rows = await tx
    .select({ leadKey: permitFunnelStages.leadKey, stage: permitFunnelStages.stage })
    .from(permitFunnelStages)
    .where(eq(permitFunnelStages.orgId, orgId))
    .orderBy(asc(permitFunnelStages.leadKey))
    .limit(LIMIT);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.stage, (counts.get(r.stage) ?? 0) + 1);
  const byStage = (FUNNEL_STAGES as readonly string[]).map((stage) => ({
    stage: stage as FunnelStage,
    label: FUNNEL_STAGE_LABEL[stage as FunnelStage],
    count: counts.get(stage) ?? 0,
  }));
  const unknownStages = [...counts.entries()].filter(([s]) => !(FUNNEL_STAGES as readonly string[]).includes(s));
  const total = rows.length;
  const truncated = rows.length === LIMIT;
  const stageText = byStage.map((s) => `${s.count} ${s.label.toLowerCase()}`).join(', ');
  return {
    tool: 'pipeline_value',
    label: BUSINESS_TOOL_LABELS.pipeline_value,
    rowCount: total,
    truncated,
    summary:
      total === 0
        ? 'No funnel leads recorded for your company yet, so there is no pipeline to report.'
        : `${total} funnel lead${total === 1 ? '' : 's'}: ${stageText}. ` +
          (openQuotesTotal.totalMinor === null
            ? 'No open roof quotes exist, so no pipeline value can be counted from quotes.'
            : `The open roof quotes behind this pipeline are worth ${moneyOrUnknown(openQuotesTotal.totalMinor, openQuotesTotal.currency)} across ${openQuotesTotal.count} open quote${openQuotesTotal.count === 1 ? '' : 's'} — that is the only pipeline value counted, because funnel leads have no quote attached until one is created.`) +
          (unknownStages.length ? ` ${unknownStages.length} lead(s) sit in a stage no longer listed.` : '') +
          capNote(truncated),
    rows: byStage.map((s) => ({ stage: s.stage, label: s.label, count: s.count })),
    totalMinor: openQuotesTotal.totalMinor,
    currency: openQuotesTotal.currency,
  };
}

/** Jobs grouped by customer-visible stage (intake → estimating → scheduled → in progress → completed). */
async function jobsByStatus(tx: Tx, orgId: string): Promise<BusinessToolResult> {
  const LIMIT = 500;
  const rows = await tx
    .select({
      number: jobs.number,
      title: jobs.title,
      stageKey: jobs.stageKey,
      status: jobs.status,
      estimatedValueMinor: jobs.estimatedValueMinor,
      currency: jobs.currency,
    })
    .from(jobs)
    .where(and(eq(jobs.orgId, orgId), sql`${jobs.deletedAt} IS NULL`))
    .orderBy(asc(jobs.stageKey))
    .limit(LIMIT);
  const grouped = new Map<string, { count: number; valueMinor: number; valued: number }>();
  for (const r of rows) {
    const g = grouped.get(r.stageKey) ?? { count: 0, valueMinor: 0, valued: 0 };
    g.count += 1;
    if (r.estimatedValueMinor !== null) {
      g.valueMinor += r.estimatedValueMinor;
      g.valued += 1;
    }
    grouped.set(r.stageKey, g);
  }
  const currency = rows.find((r) => r.currency !== null)?.currency ?? 'USD';
  const byStage = [...grouped.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([stage, g]) => ({
      stage,
      label: customerStageLabel(stage),
      count: g.count,
      estimatedValueMinor: g.valued === 0 ? null : g.valueMinor,
    }));
  const truncated = rows.length === LIMIT;
  return {
    tool: 'jobs_by_status',
    label: BUSINESS_TOOL_LABELS.jobs_by_status,
    rowCount: rows.length,
    truncated,
    summary:
      rows.length === 0
        ? 'No jobs recorded for your company.'
        : `${rows.length} job${rows.length === 1 ? '' : 's'}: ` +
          byStage
            .map(
              (s) =>
                `${s.count} ${s.label.toLowerCase()}${s.estimatedValueMinor === null ? '' : ` (estimated ${moneyOrUnknown(s.estimatedValueMinor, currency)})`}`,
            )
            .join(', ') +
          '.' +
          capNote(truncated),
    rows: byStage.map((s) => ({
      stage: s.stage,
      label: s.label,
      count: s.count,
      estimatedValueMinor: s.estimatedValueMinor,
    })),
    totalMinor: null,
    currency,
  };
}

/** Invoices still owed: issued or partially paid, balance = total − paid. */
async function outstandingInvoices(tx: Tx, orgId: string): Promise<BusinessToolResult> {
  const LIMIT = 100;
  const rows = await tx
    .select({
      number: invoices.number,
      status: invoices.status,
      totalMinor: invoices.totalMinor,
      amountPaidMinor: invoices.amountPaidMinor,
      currency: invoices.currency,
      dueOn: invoices.dueOn,
    })
    .from(invoices)
    .where(
      and(eq(invoices.orgId, orgId), inArray(invoices.status, ['issued', 'partially_paid'])),
    )
    .orderBy(asc(invoices.dueOn))
    .limit(LIMIT);
  const totalMinor = rows.reduce((sum, r) => sum + (r.totalMinor - r.amountPaidMinor), 0);
  const currency = rows[0]?.currency ?? 'USD';
  const truncated = rows.length === LIMIT;
  return {
    tool: 'outstanding_invoices',
    label: BUSINESS_TOOL_LABELS.outstanding_invoices,
    rowCount: rows.length,
    truncated,
    summary:
      rows.length === 0
        ? 'No outstanding invoices recorded for your company — nothing issued is still unpaid.'
        : `${rows.length} outstanding invoice${rows.length === 1 ? '' : 's'} totalling ${moneyOrUnknown(totalMinor, currency)} still owed.${capNote(truncated)}`,
    rows: rows.map((r) => ({
      number: r.number,
      status: r.status,
      totalMinor: r.totalMinor,
      amountPaidMinor: r.amountPaidMinor,
      balanceMinor: r.totalMinor - r.amountPaidMinor,
      currency: r.currency,
      dueOn: r.dueOn,
    })),
    totalMinor: rows.length === 0 ? null : totalMinor,
    currency,
  };
}

/**
 * Runs the selected tools — each one scoped read query. pipeline_value shares the single
 * openQuotes run (its value source) instead of querying quotes a second time.
 */
export async function runBusinessTools(
  tx: Tx,
  orgId: string,
  tools: readonly BusinessToolName[],
  range: MonthRange,
): Promise<BusinessToolResult[]> {
  const needQuotes = tools.includes('open_quotes') || tools.includes('pipeline_value');
  const quotes = needQuotes ? await openQuotes(tx, orgId) : null;
  const results: BusinessToolResult[] = [];
  for (const tool of tools) {
    if (tool === 'open_quotes' && quotes) {
      results.push(quotes);
    } else if (tool === 'pipeline_value') {
      results.push(
        await pipelineValue(tx, orgId, {
          totalMinor: quotes?.totalMinor ?? null,
          count: quotes?.rowCount ?? 0,
          currency: quotes?.currency ?? 'USD',
        }),
      );
    } else if (tool === 'signed_this_month') {
      results.push(await signedThisMonth(tx, orgId, range));
    } else if (tool === 'jobs_by_status') {
      results.push(await jobsByStatus(tx, orgId));
    } else {
      results.push(await outstandingInvoices(tx, orgId));
    }
  }
  return results;
}

/** Keyword router: which tools answer this question. No keyword match runs every tool. */
export function pickBusinessTools(question: string): BusinessToolName[] {
  const q = question.toLowerCase();
  const picked: BusinessToolName[] = [];
  if (/\bsign(ed|ing|s)?\b|\bwon\b|\bclosed\b/.test(q)) picked.push('signed_this_month');
  if (/\bquotes?\b|\bestimates?\b/.test(q)) picked.push('open_quotes');
  if (/\bpipeline\b|\bfunnel\b|\bleads?\b/.test(q)) picked.push('pipeline_value');
  if (/\bjobs?\b/.test(q)) picked.push('jobs_by_status');
  if (/\binvoices?\b|\bowed\b|\boutstanding\b|\bunpaid\b|\bpaid\b|\breceivable/.test(q))
    picked.push('outstanding_invoices');
  return picked.length > 0 ? picked : [...BUSINESS_TOOL_NAMES];
}

/** Deterministic answer built only from tool summaries — no model, no invented figures. */
export function formatBusinessAnswer(
  results: readonly BusinessToolResult[],
  range: MonthRange,
): string {
  if (results.length === 0) return 'No business data was found to answer that.';
  const lines = results.map((r) => `- ${r.label}: ${r.summary}`);
  return `From your company data (${range.label}):\n${lines.join('\n')}`;
}

/** System prompt for the model: answer only from the data below, quote it, never invent. */
export function buildBusinessMessages(
  question: string,
  results: readonly BusinessToolResult[],
  range: MonthRange,
): ChatMessage[] {
  const data = results.map((r) => ({
    tool: r.tool,
    label: r.label,
    rowCount: r.rowCount,
    summary: r.summary,
    totalMinor: r.totalMinor,
    currency: r.currency,
    rows: r.rows,
  }));
  return [
    {
      role: 'system',
      content: `You are Ask Field Pro, answering a roofing contractor about their own business data for ${range.label}.
Rules:
- Answer ONLY from the business data below. Quote its figures exactly as given.
- If a tool found nothing, say "none recorded" for that item and name the scope (your company, ${range.label}). Never present 0 as a computed total, and never invent a figure, a customer, a job or a price.
- Money is in minor units (cents) where shown; write it as dollars.
- Keep the answer short: lead with the number asked for, then one line per tool used.
- Do not claim to have changed, sent or created anything: this search is read-only.`,
    },
    {
      role: 'user',
      content: `Question: ${question}\n\nBusiness data:\n${JSON.stringify(data, null, 2)}`,
    },
  ];
}

export interface BusinessSearchOutcome {
  answer: string;
  aiConnected: boolean;
  source: 'home_server' | 'backup_model' | 'data_only';
  model: string;
  sources: BusinessToolSource[];
}

/**
 * Answers a business question from already-fetched tool results. Home AI server first,
 * backup model second (same Qwen hook as Ask Field Pro — no new provider). When no AI is
 * configured, or every model fails, the answer is the deterministic count summary with
 * aiConnected false / source 'data_only' — real rows, never a fake answer.
 */
export async function answerBusinessSearch(input: {
  question: string;
  results: readonly BusinessToolResult[];
  range: MonthRange;
  models: { home: OpenModelSettings | null; backup: OpenModelSettings | null };
  chat: ChatFn;
  onFallback?: (error: unknown) => void;
}): Promise<BusinessSearchOutcome> {
  const { question, results, range, models, chat } = input;
  const sources: BusinessToolSource[] = results.map((r) => ({
    tool: r.tool,
    label: r.label,
    rowCount: r.rowCount,
    summary: r.summary,
  }));
  const directAnswer = formatBusinessAnswer(results, range);
  const tries: ['home_server' | 'backup_model', OpenModelSettings][] = [];
  if (models.home) tries.push(['home_server', models.home]);
  if (models.backup) tries.push(['backup_model', models.backup]);
  if (tries.length === 0) {
    return { answer: directAnswer, aiConnected: false, source: 'data_only', model: '', sources };
  }
  const messages = buildBusinessMessages(question, results, range);
  for (const [source, settings] of tries) {
    try {
      const answer = await chat(settings, messages);
      return { answer, aiConnected: true, source, model: settings.model, sources };
    } catch (error) {
      input.onFallback?.(error);
    }
  }
  return {
    answer: `${directAnswer}\n\n(The AI summary was unavailable, so this is the direct count from your records.)`,
    aiConnected: true,
    source: 'data_only',
    model: '',
    sources,
  };
}
