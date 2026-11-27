// Plan-to-Bid: upload construction plans, read the drawings and specs, and build a
// review-ready takeoff, estimate and bid package organized by trade, in build sequence.
// Nothing here sends a proposal: proposals are a stub (see docs/phase-f-claims-audit.md),
// so every bid package is labeled DRAFT until a person reviews and approves every line.
// Prices are never invented: material prices come from the dated price book or a live
// SerpApi lookup, labor/subcontractor costs only from contractor-entered rates, and a
// blank price is "Price missing", never a guess.
import { z } from 'zod';
import { HOUSE_PLAN_MEDIA_TYPES, PlanGeometryReadingSchema } from './homeBrief';

/** Trades in build sequence, as shown in the bid package and the sequence view. */
export const PlanToBidTradeSchema = z.enum([
  'sitework',
  'excavation',
  'foundations',
  'underground_plumbing',
  'rebar_vapor',
  'structural_steel',
  'framing',
  'roofing',
  'envelope',
  'electrical',
  'plumbing',
  'hvac',
  'interior_finishes',
  'exterior_finishes',
]);
export type PlanToBidTrade = z.infer<typeof PlanToBidTradeSchema>;

export const PLAN_TO_BID_TRADES: readonly PlanToBidTrade[] = [
  'sitework',
  'excavation',
  'foundations',
  'underground_plumbing',
  'rebar_vapor',
  'structural_steel',
  'framing',
  'roofing',
  'envelope',
  'electrical',
  'plumbing',
  'hvac',
  'interior_finishes',
  'exterior_finishes',
];

export const PLAN_TO_BID_TRADE_LABELS: Record<PlanToBidTrade, string> = {
  sitework: 'Sitework & Landscape',
  excavation: 'Excavation',
  foundations: 'Foundations',
  underground_plumbing: 'Underground Plumbing',
  rebar_vapor: 'Rebar & Vapor Barrier',
  structural_steel: 'Structural Steel',
  framing: 'Framing',
  roofing: 'Roofing',
  envelope: 'Envelope & Exterior',
  electrical: 'Electrical',
  plumbing: 'Plumbing',
  hvac: 'HVAC',
  interior_finishes: 'Interior Finishes',
  exterior_finishes: 'Exterior Finishes & Site',
};

/** Where a draft line came from. 'ai' only when the connected AI classified it. */
export const PlanToBidLineSourceSchema = z.enum(['plan_text', 'geometry', 'takeoff', 'ai', 'manual']);
export type PlanToBidLineSource = z.infer<typeof PlanToBidLineSourceSchema>;

/** One draft takeoff line, as produced by the plan reader. Quantities and prices stay null when not stated or not measured — never guessed. */
export const PlanToBidDraftLineSchema = z.object({
  trade: PlanToBidTradeSchema,
  label: z.string().min(1).max(160),
  unit: z.string().min(1).max(24),
  quantity: z.number().positive().max(1_000_000).nullable(),
  source: PlanToBidLineSourceSchema,
  /** Short quote from the plan text or a note about how the line was measured. */
  evidence: z.string().max(300).nullable(),
  /** 0-1 confidence from the reader, when it has one. */
  confidence: z.number().min(0).max(1).nullable(),
});
export type PlanToBidDraftLine = z.infer<typeof PlanToBidDraftLineSchema>;

/** Plan files Plan-to-Bid reads: a PDF exported from CAD, or an AutoCAD DXF/DWG. */
export const PLAN_TO_BID_MEDIA_TYPES = ['application/pdf', 'application/dxf', 'image/vnd.dwg'] as const;

export const PlanToBidReadRequestSchema = z.object({
  /** A plan sheet: base64 without the data: prefix. About 8 MB of file at most. */
  file: z.object({
    mediaType: z.enum(PLAN_TO_BID_MEDIA_TYPES),
    data: z.string().max(11_200_000).regex(/^[A-Za-z0-9+/=]+$/),
    name: z.string().trim().min(1).max(200).optional(),
  }),
  /** Optional project name for the draft bid package. */
  projectName: z.string().trim().min(1).max(160).optional(),
});
export type PlanToBidReadRequest = z.infer<typeof PlanToBidReadRequestSchema>;

/** Measured footprint the web uses to run the existing takeoff engine. */
export const PlanToBidSpecHintSchema = z.object({
  lengthFt: z.number().min(16).max(120),
  widthFt: z.number().min(16).max(80),
  stories: z.union([z.literal(1), z.literal(2)]),
});
export type PlanToBidSpecHint = z.infer<typeof PlanToBidSpecHintSchema>;

export const PlanToBidReadResponseSchema = z.object({
  fileName: z.string().nullable(),
  geometry: PlanGeometryReadingSchema.nullable(),
  /** Truncated plan text (first 6,000 chars) so the reviewer can see what was read. */
  planText: z.string(),
  /** Was there a readable text layer at all. */
  hasText: z.boolean(),
  specHint: PlanToBidSpecHintSchema.nullable(),
  /** Draft lines from the deterministic reader (plan text + measured geometry). */
  lines: z.array(PlanToBidDraftLineSchema),
  /** Draft lines the connected AI classified, or null when no AI is set up. */
  aiLines: z.array(PlanToBidDraftLineSchema).nullable(),
  aiModel: z.string().nullable(),
  aiSource: z.enum(['home', 'open']).nullable(),
  aiReading: z.boolean(),
  notes: z.array(z.string().max(300)),
});
export type PlanToBidReadResponse = z.infer<typeof PlanToBidReadResponseSchema>;

export const PlanToBidStatusResponseSchema = z.object({
  aiReading: z.boolean(),
  homeAiServer: z.enum(['configured', 'not_configured']),
  backupModel: z.enum(['configured', 'not_configured']),
  livePrices: z.boolean(),
  livePricesMessage: z.string(),
});
export type PlanToBidStatusResponse = z.infer<typeof PlanToBidStatusResponseSchema>;

/** One reviewed line in the bid package: quantity and unit price are contractor-confirmed. */
export const PlanToBidBidLineSchema = z.object({
  trade: PlanToBidTradeSchema,
  label: z.string().min(1).max(160),
  unit: z.string().min(1).max(24),
  quantity: z.number().positive().max(1_000_000).nullable(),
  unitPrice: z.number().min(0).max(1_000_000).nullable(),
  /** Where the price came from: dated price book, live listing, or typed by the contractor. */
  priceSource: z.string().max(120).nullable(),
  priceCheckedAt: z.string().max(40).nullable(),
  approved: z.boolean(),
  notes: z.string().max(300).optional(),
});
export type PlanToBidBidLine = z.infer<typeof PlanToBidBidLineSchema>;

/** Contractor-entered labor / subcontractor allowance for one trade. Blank means not priced. */
export const PlanToBidTradeCostSchema = z.object({
  trade: PlanToBidTradeSchema,
  laborHours: z.number().min(0).max(100_000).nullable(),
  laborRate: z.number().min(0).max(10_000).nullable(),
  subcontractorAmount: z.number().min(0).max(100_000_000).nullable(),
});
export type PlanToBidTradeCost = z.infer<typeof PlanToBidTradeCostSchema>;

export const PlanToBidBidPackageRequestSchema = z.object({
  projectName: z.string().trim().min(1).max(160),
  organizationName: z.string().trim().min(1).max(160),
  lines: z.array(PlanToBidBidLineSchema).min(1).max(500),
  tradeCosts: z.array(PlanToBidTradeCostSchema).max(14),
  /** Free-text notes printed on the package (exclusions, assumptions). */
  notes: z.array(z.string().max(300)).max(20).optional(),
});
export type PlanToBidBidPackageRequest = z.infer<typeof PlanToBidBidPackageRequestSchema>;

export const PlanToBidBidPackageResponseSchema = z.object({
  filename: z.string(),
  contentBase64: z.string(),
  sha256Hex: z.string(),
  pages: z.number().int().min(1),
  lines: z.number().int(),
  approvedLines: z.number().int(),
  unpricedLines: z.number().int(),
  totalCents: z.number().int().nullable(),
});
export type PlanToBidBidPackageResponse = z.infer<typeof PlanToBidBidPackageResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Plan audit (AI Architecture reel, tool #5 idea: auto-tagging/audit agent for uploaded plans).
// The deterministic reader tags what the plan names (draft lines with evidence); the audit adds
// plain-language findings about what is missing or inconsistent. Real element detection (seeing
// fixtures, symbols and details in a scan) needs a vision model — the audit works on the plan's
// text and measured lines only and says so. Nothing is priced here.
// ---------------------------------------------------------------------------------------------

export const PlanAuditFindingSchema = z.object({
  id: z.string().min(1).max(64),
  severity: z.enum(['problem', 'note']),
  trade: PlanToBidTradeSchema.nullable(),
  title: z.string().min(1).max(160),
  detail: z.string().min(1).max(600),
  /** Short quote from the plan text backing the finding, when there is one. */
  evidence: z.string().max(300).nullable(),
});
export type PlanAuditFinding = z.infer<typeof PlanAuditFindingSchema>;

export const PlanAuditResponseSchema = z.object({
  fileName: z.string().nullable(),
  geometry: PlanGeometryReadingSchema.nullable(),
  hasText: z.boolean(),
  /** Tags from the deterministic reader (plan text + measured geometry). */
  tags: z.array(PlanToBidDraftLineSchema),
  /** Tags the connected AI classified, or null when no AI is set up. */
  aiTags: z.array(PlanToBidDraftLineSchema).nullable(),
  aiModel: z.string().nullable(),
  aiSource: z.enum(['home', 'open']).nullable(),
  aiReading: z.boolean(),
  findings: z.array(PlanAuditFindingSchema),
  notes: z.array(z.string().max(300)),
});
export type PlanAuditResponse = z.infer<typeof PlanAuditResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Labor rate book (audit-gaps round 2): contractor-entered hourly rates per trade, stored
// per organization and reusable across bids. A rate is applied to a bid ONLY when the
// contractor picks it — Field Pro never fills in a labor rate. An empty book is an honest
// empty state. Rates are integer minor units (cents per hour).
// ---------------------------------------------------------------------------------------------

export const LaborRateSchema = z.object({
  id: z.string(),
  trade: PlanToBidTradeSchema,
  label: z.string().min(1).max(80),
  rateCentsPerHour: z.number().int().min(1).max(1_000_000),
  note: z.string().max(300),
  updatedAt: z.string(),
});
export type LaborRate = z.infer<typeof LaborRateSchema>;

export const LaborRateCreateSchema = z.object({
  trade: PlanToBidTradeSchema,
  label: z.string().trim().min(1).max(80),
  rateCentsPerHour: z.number().int().min(1).max(1_000_000),
  note: z.string().trim().max(300).optional(),
});
export type LaborRateCreate = z.infer<typeof LaborRateCreateSchema>;

export const LaborRateUpdateSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  rateCentsPerHour: z.number().int().min(1).max(1_000_000).optional(),
  note: z.string().trim().max(300).optional(),
});
export type LaborRateUpdate = z.infer<typeof LaborRateUpdateSchema>;

export const LaborRatesListResponseSchema = z.object({
  rates: z.array(LaborRateSchema),
  note: z.string(),
});
export type LaborRatesListResponse = z.infer<typeof LaborRatesListResponseSchema>;

export const LaborRateDeleteResponseSchema = z.object({
  ok: z.boolean(),
});
export type LaborRateDeleteResponse = z.infer<typeof LaborRateDeleteResponseSchema>;

export { HOUSE_PLAN_MEDIA_TYPES };
