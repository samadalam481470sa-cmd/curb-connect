// Turn stored dead-link rows into opportunities for one contractor's trade, and (optionally)
// draft the outreach email with the user's own Qwen model.
//
// The "what to offer" text is deterministic — built from the trade and the page, never from
// invented page content. The AI draft only polishes that into an email; when no AI server is
// configured the draft endpoint reports it honestly instead of faking a draft.
import type { GovOpportunity } from '@fieldline/contracts';
import { z } from 'zod';
import {
  askOpenModelWithFallback,
  type FetchLike,
  type OpenModelSettings,
} from '../../services/open-model';
import { tradeKeywords } from './seeds';
import type { GovLinkRow } from './scanner';

export type TradeMatch = 'strong' | 'general';

/** A dead link matches the trade 'strong' when its text or URL names the trade's keywords. */
export function matchTrade(row: GovLinkRow, trade: string): TradeMatch {
  const haystack = `${row.linkText} ${row.linkUrl}`.toLowerCase();
  return tradeKeywords(trade).some((word) => haystack.includes(word)) ? 'strong' : 'general';
}

const TRADE_LABELS: Record<string, string> = {
  grading: 'grading and site work',
  concrete: 'concrete and curb work',
  roofing: 'roofing',
  materials: 'building materials supply',
  framing: 'framing',
  hvac: 'HVAC',
  electrical: 'electrical',
  plumbing: 'plumbing',
  general: 'general contracting',
};

export function tradeLabel(trade: string): string {
  return TRADE_LABELS[trade] ?? trade;
}

/** Plain-language suggestion of what the contractor can offer as the replacement page. */
export function whatToOffer(trade: string, pageName: string): string {
  return (
    `Offer your ${tradeLabel(trade)} services page as the replacement link on "${pageName}". ` +
    `The page's editors get a working link for their visitors, and your company gets a .gov ` +
    `backlink. Contact the page through the site itself — Field Pro does not invent a contact email.`
  );
}

/** Dead links only, strongest matches first, then most recently checked. */
export function buildOpportunities(rows: GovLinkRow[], trade: string): GovOpportunity[] {
  return rows
    .filter((row) => row.status === 'dead')
    .map((row) => ({
      pageId: row.pageId,
      pageName: row.pageName,
      pageCity: row.pageCity,
      pageUrl: row.pageUrl,
      deadUrl: row.linkUrl,
      linkText: row.linkText || '(no link text)',
      trade,
      match: matchTrade(row, trade),
      whatToOffer: whatToOffer(trade, row.pageName),
      httpStatus: row.httpStatus,
      checkedAt: row.checkedAt,
    }))
    .sort((a, b) =>
      a.match === b.match ? b.checkedAt.localeCompare(a.checkedAt) : a.match === 'strong' ? -1 : 1,
    );
}

export interface GovDraftConfig {
  homeAi: OpenModelSettings | null;
  openModel: OpenModelSettings | null;
}

const DraftSchema = z.object({ draft: z.string().min(20).max(4000) });

/** Draft the outreach email for one dead-link opportunity with the user's Qwen model.
 *  Returns null when no AI server is configured — the caller reports that honestly. */
export async function draftOutreach(
  config: GovDraftConfig,
  opportunity: { pageName: string; pageUrl: string; deadUrl: string; linkText: string; trade: string },
  company: { name: string; yourName: string; website: string },
  fetchImpl: FetchLike = fetch,
): Promise<{ draft: string; model: string; source: 'home' | 'open' } | null> {
  const settings = config.homeAi ?? config.openModel;
  if (!settings) return null;
  const source = config.homeAi ? ('home' as const) : ('open' as const);
  const system = [
    'You write a short, polite outreach email from a contractor to the editor of a government resource page.',
    'The email points out one dead link on their page and offers the contractor\'s own service page as a working replacement. It never claims the replacement page already exists, never invents a contact name, and never promises anything the contractor has not said.',
    'Reply with ONLY a JSON object {"draft": "..."}, no prose. The draft is at most 200 words, with a subject line first.',
  ].join('\n');
  const user = [
    `Government page: ${opportunity.pageName} (${opportunity.pageUrl})`,
    `Dead link on that page: ${opportunity.deadUrl} (link text: ${opportunity.linkText || 'none'})`,
    `Contractor: ${company.name}, trade: ${tradeLabel(opportunity.trade)}${company.website ? `, website: ${company.website}` : ''}`,
    `Sender name: ${company.yourName || 'the contractor'}`,
  ].join('\n');
  const answer = await askOpenModelWithFallback(
    settings,
    { text: `${system}\n\n${user}`, image: null, maxTokens: 2000, timeoutMs: 90_000 },
    fetchImpl,
  );
  const parsed = DraftSchema.safeParse(extractJsonObject(answer.reply));
  if (!parsed.success) throw new Error('The AI server did not return a usable draft.');
  return { draft: parsed.data.draft, model: answer.model, source };
}

/** Extract the first balanced JSON object from a model reply, or null. */
export function extractJsonObject(reply: string): unknown {
  const start = reply.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < reply.length; i++) {
    const ch = reply[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(reply.slice(start, i + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
