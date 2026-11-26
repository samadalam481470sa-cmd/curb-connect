// Plan-to-Bid API: read an uploaded construction plan into a review-ready takeoff,
// estimate and bid package, organized by trade in build sequence.
//
// The deterministic reader (plan text keywords + measured geometry) always runs. The
// connected AI (the user's own Qwen model through the existing hook) may add classified
// lines; when no AI is set up the flow still works and says so. Material prices come from
// the live SerpApi lookup when configured, otherwise the answer says so honestly.
// Labor and subcontractor costs are only ever contractor-entered. Nothing here sends a
// proposal — the bid package is a DRAFT until a person approves every line.
import { renderToBuffer } from '@fieldline/pdf';
import type { BidPackageSnapshot } from '@fieldline/pdf';
import {
  PLAN_TO_BID_TRADE_LABELS,
  PlanAuditResponseSchema,
  PlanToBidBidPackageRequestSchema,
  PlanToBidBidPackageResponseSchema,
  PlanToBidReadRequestSchema,
  PlanToBidReadResponseSchema,
  PlanToBidStatusResponseSchema,
  type PlanGeometryReading,
  type PlanAuditResponse,
  type PlanToBidBidLine,
  type PlanToBidReadRequest,
  type PlanToBidReadResponse,
  type PlanToBidTrade,
} from '@fieldline/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { requireOrg } from '../../http/context';
import { problem } from '../../http/problem';
import { dwgToDxf, looksLikeDwg } from '../../services/plan-dwg';
import { analyzeDxfPlan, analyzePlanGeometry, extractPlanGeometry } from '../../services/plan-geometry';
import { extractPlanPdfText, hasReadableText } from '../../services/plan-pdf';
import { quantitiesFromGeometry, specHintFromGeometry } from './intake';
import { classifyPlanWithAi } from './plan-ai';
import { classifyPlanText } from './trades';
import { auditPlan } from './audit';

const MAX_FILE_BYTES = 8 * 1024 * 1024;

type PlanFile = PlanToBidReadRequest['file'];

/** Read an uploaded plan file into measured geometry + plan text (shared by /read and /audit). */
async function readUploadedPlan(
  log: { info: (obj: Record<string, unknown>, msg: string) => void },
  file: PlanFile,
): Promise<{ geometry: PlanGeometryReading | null; planText: string }> {
  const bytes = Buffer.from(file.data, 'base64');
  if (bytes.length > MAX_FILE_BYTES) {
    throw problem('validation_failed', 'That plan file is larger than 8 MB. Export the plan page alone, or a smaller file.');
  }
  let planText = '';
  let geometry: PlanGeometryReading | null = null;

  if (file.mediaType === 'image/vnd.dwg') {
    if (!looksLikeDwg(new Uint8Array(bytes))) {
      throw problem('validation_failed', 'That file is not an AutoCAD DWG drawing.');
    }
    let dxfText: string | null = null;
    try {
      dxfText = await dwgToDxf(new Uint8Array(bytes));
    } catch (err) {
      log.info({ err: (err as Error).message }, 'plan-to-bid dwg conversion failed');
    }
    if (!dxfText) {
      throw problem('validation_failed', 'That DWG could not be opened. In AutoCAD use Save As → DXF and upload the .dxf file.');
    }
    try {
      const read = analyzeDxfPlan(dxfText);
      if (read.footprint || read.rooms.length) geometry = read;
    } catch (err) {
      log.info({ err: (err as Error).message }, 'plan-to-bid dxf plan could not be read');
    }
  } else if (file.mediaType === 'application/dxf') {
    try {
      const read = analyzeDxfPlan(bytes.toString('latin1'));
      if (read.footprint || read.rooms.length) geometry = read;
    } catch (err) {
      log.info({ err: (err as Error).message }, 'plan-to-bid dxf plan could not be read');
    }
  } else {
    // PDF: walls and rooms measured from the drawn lines, plus the text layer.
    try {
      const read = analyzePlanGeometry(await extractPlanGeometry(new Uint8Array(bytes)));
      if (read.footprint || read.rooms.length) geometry = read;
    } catch (err) {
      log.info({ err: (err as Error).message }, 'plan-to-bid pdf geometry could not be read');
    }
    try {
      const pdf = await extractPlanPdfText(new Uint8Array(bytes));
      if (hasReadableText(pdf.text)) planText = pdf.text;
    } catch (err) {
      log.info({ err: (err as Error).message }, 'plan-to-bid pdf has no readable text layer');
    }
  }
  return { geometry, planText };
}

const toCents = (dollars: number) => Math.round(dollars * 100);

function bidTotals(lines: readonly PlanToBidBidLine[], tradeCosts: readonly { trade: PlanToBidTrade; laborHours: number | null; laborRate: number | null; subcontractorAmount: number | null }[]) {
  let materialCents = 0;
  let laborCents = 0;
  let subcontractorCents = 0;
  let approved = 0;
  let unpriced = 0;
  for (const line of lines) {
    if (!line.approved) continue;
    approved += 1;
    if (line.quantity === null || line.unitPrice === null) {
      unpriced += 1;
      continue;
    }
    materialCents += toCents(line.quantity * line.unitPrice);
  }
  for (const cost of tradeCosts) {
    if (cost.laborHours !== null && cost.laborRate !== null) laborCents += toCents(cost.laborHours * cost.laborRate);
    if (cost.subcontractorAmount !== null) subcontractorCents += toCents(cost.subcontractorAmount);
  }
  const totalCents = unpriced === 0 ? materialCents + laborCents + subcontractorCents : null;
  return { materialCents, laborCents, subcontractorCents, totalCents, approved, unpriced };
}

const planToBidModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/plan-to-bid/status',
    {
      config: { permission: 'estimate:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['plan-to-bid'],
        summary: 'Plan-to-Bid AI and live-price status',
        response: { 200: PlanToBidStatusResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const { homeAi, openModel } = request.server.config;
      const aiReading = homeAi !== null || openModel !== null;
      const livePrices = request.server.config.market.serpApiKey !== undefined;
      return {
        aiReading,
        homeAiServer: homeAi ? ('configured' as const) : ('not_configured' as const),
        backupModel: openModel ? ('configured' as const) : ('not_configured' as const),
        livePrices,
        livePricesMessage: livePrices
          ? 'Live store listings are set up (SerpApi).'
          : 'Live store listings are not set up on this server (SERPAPI_API_KEY). Material lines use the dated price book until a price is entered.',
      };
    },
  );

  app.post(
    '/plan-to-bid/read',
    {
      bodyLimit: 12 * 1024 * 1024,
      config: { permission: 'estimate:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['plan-to-bid'],
        summary: 'Read an uploaded plan into draft takeoff lines by trade',
        body: PlanToBidReadRequestSchema,
        response: { 200: PlanToBidReadResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const { file, projectName } = request.body;
      const { homeAi, openModel } = request.server.config;
      const notes: string[] = [];
      const { geometry, planText } = await readUploadedPlan(request.log, file);

      if (!geometry && !planText) {
        throw problem(
          'validation_failed',
          'That drawing has no walls, room labels or readable text that could be read. Upload a PDF exported from CAD, or a DXF/DWG floor plan.',
        );
      }
      if (geometry) notes.push('Measured the plan\u2019s drawn lines (no AI needed). Check each value before it drives the estimate.');
      if (planText) notes.push('Read the plan file\u2019s text (no AI needed). Quantities are only stated when the plan states them.');
      if (projectName) notes.push(`Draft bid package for “${projectName}”.`);

      // Deterministic lines first: measured geometry, then keyword matches in the plan text.
      const lines = [...quantitiesFromGeometry(geometry), ...classifyPlanText(planText)];

      // Optional AI classification of the same text (never replaces the deterministic lines).
      let aiLines: PlanToBidReadResponse['aiLines'] = null;
      let aiModel: string | null = null;
      let aiSource: 'home' | 'open' | null = null;
      const aiReading = homeAi !== null || openModel !== null;
      if (aiReading && planText) {
        const geometrySummary = geometry?.footprint
          ? `Measured from the drawn wall lines: outline ${geometry.footprint.lengthFt} ft by ${geometry.footprint.widthFt} ft, ${geometry.rooms.length} labeled rooms, ${geometry.doors} door swings.`
          : 'No geometry could be measured from the drawn lines.';
        const ai = await classifyPlanWithAi({ homeAi, openModel }, planText, geometrySummary).catch((err) => {
          request.log.info({ err: (err as Error).message }, 'plan-to-bid ai classification failed');
          return null;
        });
        if (ai) {
          aiLines = ai.lines;
          aiModel = ai.model;
          aiSource = ai.source;
          notes.push(`AI (${ai.source === 'home' ? 'home AI server' : 'open model'}) classified ${ai.lines.length} additional line items. Review each one — the AI only labels what the plan text says.`);
        } else {
          notes.push('AI classification did not return usable lines; the deterministic reading above is the whole draft.');
        }
      } else if (!aiReading) {
        notes.push('AI classification is not set up on this server. The draft above comes from the plan\u2019s own text and measured lines only.');
      }

      return {
        fileName: file.name ?? null,
        geometry,
        planText: planText.slice(0, 6000),
        hasText: planText.length > 0,
        specHint: specHintFromGeometry(geometry),
        lines,
        aiLines,
        aiModel,
        aiSource,
        aiReading,
        notes: notes.slice(0, 12),
      };
    },
  );

  app.post(
    '/plan-to-bid/audit',
    {
      bodyLimit: 12 * 1024 * 1024,
      config: { permission: 'estimate:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['plan-to-bid'],
        summary:
          'Audit an uploaded plan: auto-tag what it names by trade and flag what is missing or inconsistent (text + measured lines only; no element detection without a vision model)',
        body: PlanToBidReadRequestSchema,
        response: { 200: PlanAuditResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const { file } = request.body;
      const { homeAi, openModel } = request.server.config;
      const notes: string[] = [];
      const { geometry, planText } = await readUploadedPlan(request.log, file);

      if (!geometry && !planText) {
        throw problem(
          'validation_failed',
          'That drawing has no walls, room labels or readable text that could be audited. Upload a PDF exported from CAD, or a DXF/DWG floor plan.',
        );
      }
      notes.push(
        'Audit checks the plan\u2019s text and measured lines only. Seeing fixtures, symbols and details in a scan needs a vision model, which this audit does not claim.',
      );

      const tags = [...quantitiesFromGeometry(geometry), ...classifyPlanText(planText)];
      const findings = auditPlan({ geometry, planText, lines: tags });

      let aiTags: PlanAuditResponse['aiTags'] = null;
      let aiModel: string | null = null;
      let aiSource: 'home' | 'open' | null = null;
      const aiReading = homeAi !== null || openModel !== null;
      if (aiReading && planText) {
        const geometrySummary = geometry?.footprint
          ? `Measured from the drawn wall lines: outline ${geometry.footprint.lengthFt} ft by ${geometry.footprint.widthFt} ft, ${geometry.rooms.length} labeled rooms, ${geometry.doors} door swings.`
          : 'No geometry could be measured from the drawn lines.';
        const ai = await classifyPlanWithAi({ homeAi, openModel }, planText, geometrySummary).catch((err) => {
          request.log.info({ err: (err as Error).message }, 'plan audit ai tagging failed');
          return null;
        });
        if (ai) {
          aiTags = ai.lines;
          aiModel = ai.model;
          aiSource = ai.source;
          notes.push(`AI (${ai.source === 'home' ? 'home AI server' : 'open model'}) tagged ${ai.lines.length} additional items. Review each one — the AI only labels what the plan text says.`);
        } else {
          notes.push('AI tagging did not return usable tags; the deterministic tags above are the whole audit.');
        }
      } else if (!aiReading) {
        notes.push('AI tagging is not set up on this server. Tags come from the plan\u2019s own text and measured lines only.');
      }

      return {
        fileName: file.name ?? null,
        geometry,
        hasText: planText.length > 0,
        tags,
        aiTags,
        aiModel,
        aiSource,
        aiReading,
        findings,
        notes: notes.slice(0, 12),
      };
    },
  );

  app.post(
    '/plan-to-bid/bid-package',
    {
      bodyLimit: 2 * 1024 * 1024,
      config: { permission: 'estimate:write', rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['plan-to-bid'],
        summary: 'Render the reviewed bid package as a DRAFT PDF (never a sent proposal)',
        body: PlanToBidBidPackageRequestSchema,
        response: { 200: PlanToBidBidPackageResponseSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      const { projectName, organizationName, lines, tradeCosts, notes } = request.body;
      const totals = bidTotals(lines, tradeCosts);
      const now = new Date();
      const documentId = `BID-${now.toISOString().slice(0, 10)}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
      const snapshot: BidPackageSnapshot = {
        kind: 'bid_package',
        meta: {
          documentId,
          revision: 1,
          issuedAt: now.toISOString(),
          organization: { name: organizationName },
          productName: 'Field Pro',
        },
        projectName,
        lines: lines.map((l) => ({
          trade: l.trade,
          tradeLabel: PLAN_TO_BID_TRADE_LABELS[l.trade],
          label: l.label,
          unit: l.unit,
          quantity: l.quantity,
          unitPriceCents: l.unitPrice === null ? null : toCents(l.unitPrice),
          amountCents: l.quantity === null || l.unitPrice === null ? null : toCents(l.quantity * l.unitPrice),
          priceSource: l.priceSource,
          approved: l.approved,
        })),
        tradeCosts: tradeCosts.map((c) => ({
          tradeLabel: PLAN_TO_BID_TRADE_LABELS[c.trade],
          laborHours: c.laborHours,
          laborRateCents: c.laborRate === null ? null : toCents(c.laborRate),
          subcontractorCents: c.subcontractorAmount === null ? null : toCents(c.subcontractorAmount),
          amountCents:
            (c.laborHours !== null && c.laborRate !== null ? toCents(c.laborHours * c.laborRate) : 0) +
            (c.subcontractorAmount !== null ? toCents(c.subcontractorAmount) : 0),
        })),
        materialTotalCents: totals.materialCents,
        laborTotalCents: totals.laborCents,
        subcontractorTotalCents: totals.subcontractorCents,
        totalCents: totals.totalCents,
        unpricedLines: totals.unpriced,
        approvedLines: totals.approved,
        notes: notes ?? [],
      };
      const rendered = await renderToBuffer(snapshot);
      return {
        filename: `${documentId}.pdf`,
        contentBase64: rendered.buffer.toString('base64'),
        sha256Hex: rendered.sha256,
        pages: rendered.pageCount,
        lines: lines.length,
        approvedLines: totals.approved,
        unpricedLines: totals.unpriced,
        totalCents: totals.totalCents,
      };
    },
  );
};

export default planToBidModule;
