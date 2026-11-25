/**
 * Plain snapshot JSON shapes the templates render from (RF-036-R: PDFs are generated from a
 * stable, immutable snapshot, never from live rows). Field names follow @fieldline/contracts
 * conventions (camelCase JSON, `amountMinor` + ISO 4217 `currency`, canonical SI lengths in
 * metres and areas in square metres, `unknown` as an explicit state) but this package does not
 * import the API or contracts at runtime, so the renderer can run in any worker.
 */

/** Integer minor units + currency, identical to contracts `Money`. */
export interface Money {
  amountMinor: number;
  currency: string;
}

/** Where a value came from (contracts provenance sources). */
export type ProvenanceSource =
  'machine_estimated' | 'imagery_derived' | 'user_entered' | 'field_verified' | 'survey_supplied';

export type MeasurementSystem = 'imperial' | 'metric';

/** A quantity that may be explicitly unknown. Unknown is never rendered as 0. */
export type Known<T> = { state: 'known'; value: T } | { state: 'unknown'; reason?: string };

export interface DocumentMeta {
  /** Stable document number shown on every page, e.g. RPT-2026-000123. */
  documentId: string;
  revision: number;
  /** ISO 8601 instant the snapshot was frozen. Also used as the PDF creation date. */
  issuedAt: string;
  /** IANA zone for printed dates (default UTC). */
  timeZone?: string;
  locale?: string;
  /** Organization (tenant) printing the document: the contractor, never Field Pro itself. */
  organization: { name: string; phone?: string; email?: string; licenseNumber?: string };
  /** Product brand from contracts BRAND (passed in so this package has one source of truth). */
  productName?: string;
}

// ---------------------------------------------------------------- roof measurement report

export interface ImageryProvenance {
  provider: string;
  captureDate?: string;
  /** Ground sample distance in metres per pixel. */
  gsdMeters?: number;
  licenseId?: string;
  /** Rights engine decision for PDF export (RF-036-S). */
  exportAllowed: boolean;
  /** Required attribution text when imagery is shown. */
  attribution?: string;
  /** Data URI or absolute file path of the licensed image, only when exportAllowed. */
  imageSrc?: string;
}

export type EdgeCategory =
  | 'ridge'
  | 'hip'
  | 'valley'
  | 'rake'
  | 'eave'
  | 'step_flashing'
  | 'wall_flashing'
  | 'drip_edge'
  | 'parapet'
  | 'transition'
  | 'unclassified';

export interface FacetSnapshot {
  id: string;
  label: string;
  /** Polygon in a local plan frame, metres (x east, y north). */
  polygon: Array<[number, number]>;
  planAreaSqM: number;
  slopedAreaSqM: number;
  /** Rise per 12 units of run (imperial pitch), e.g. 6 for 6/12. */
  pitchRisePer12: number;
  provenance: ProvenanceSource;
}

export interface EdgeSnapshot {
  id: string;
  category: EdgeCategory;
  lengthM: number;
  from: [number, number];
  to: [number, number];
  provenance: ProvenanceSource;
}

export interface StructureSnapshot {
  id: string;
  name: string;
  facets: FacetSnapshot[];
  edges: EdgeSnapshot[];
  /** Waste factor applied once to this structure's ordering quantity, e.g. 0.1. */
  wasteFactor: number;
}

export interface ReviewNote {
  author: string;
  at: string;
  text: string;
}

export interface ApprovalRecord {
  status: 'draft' | 'review_required' | 'approved';
  approverName?: string;
  approverRole?: string;
  approvedAt?: string;
}

export interface RoofReportSnapshot {
  kind: 'roof_report';
  meta: DocumentMeta;
  property: { addressLines: string[]; parcelId?: string };
  measurementSystem: MeasurementSystem;
  imagery: ImageryProvenance;
  structures: StructureSnapshot[];
  exclusions: string[];
  reviewNotes: ReviewNote[];
  methodology: string;
  disclaimers: string[];
  approval: ApprovalRecord;
}

// ---------------------------------------------------------------- curb estimate

export type GateKind =
  | 'permit'
  | 'utility_locate'
  | 'right_of_way'
  | 'professional_review'
  | 'depth_verification'
  | 'site_safety';

export interface GateStatus {
  kind: GateKind;
  status: 'satisfied' | 'pending' | 'unknown' | 'not_required';
  note?: string;
}

export interface EstimateLine {
  id: string;
  /** Cost model category (mobilization, cutting, demolition, ...). */
  category: string;
  description: string;
  /** Human-readable quantity, already rounded at the pricing stage (e.g. "18"). */
  quantity: string;
  unit: string;
  unitPrice: Money;
  total: Money;
  provenance: ProvenanceSource;
}

export interface CalibrationEvidence {
  photoId: string;
  method: 'two_point_reference' | 'planar_homography' | 'manual_tape' | 'survey';
  /** Plain-language quality, e.g. "±2 cm at 3 m". */
  quality: string;
  capturedAt?: string;
}

export interface CurbEstimateSnapshot {
  kind: 'curb_estimate';
  meta: DocumentMeta;
  site: { addressLines: string[]; jurisdiction?: string };
  /** False whenever any gate is not satisfied: the document is a budgetary range only. */
  binding: boolean;
  scenarios: { low: Money; base: Money; high: Money };
  lines: EstimateLine[];
  directCost: Money;
  overhead: Money;
  contingency: Money;
  tax: Money;
  /** Either markup or target margin was used; never both. */
  pricingMethod: { kind: 'markup'; rate: string } | { kind: 'target_margin'; rate: string };
  sellingPrice: Money;
  unknowns: Array<{ item: string; impact: string }>;
  gates: GateStatus[];
  calibration: CalibrationEvidence[];
  priceBookRevision: string;
  engineVersion: string;
  validUntil?: string;
  disclaimers: string[];
}

// ---------------------------------------------------------------- proposal

export interface ProposalOption {
  id: string;
  name: string;
  tier?: 'basic' | 'standard' | 'premium' | 'custom';
  scope: string[];
  exclusions: string[];
  lines: Array<{ description: string; total: Money }>;
  total: Money;
  warranty?: string;
}

export interface ProposalSnapshot {
  kind: 'proposal';
  meta: DocumentMeta;
  customer: { name: string; addressLines: string[] };
  title: string;
  /** True when any underlying estimate is preliminary (CP-063-S): acceptance is blocked. */
  budgetary: boolean;
  options: ProposalOption[];
  optionalAddOns: Array<{ id: string; description: string; total: Money; selected: boolean }>;
  /** Exactly one selected package id, or null while the customer has not chosen. */
  selectedOptionId: string | null;
  paymentTerms: string[];
  taxTreatment: string;
  startDateAssumption?: string;
  validUntil: string;
  terms: string[];
}

// ---------------------------------------------------------------- invoice

export interface InvoiceSnapshot {
  kind: 'invoice';
  meta: DocumentMeta;
  billTo: { name: string; addressLines: string[]; email?: string };
  status: 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void';
  dueDate: string;
  lines: Array<{
    id: string;
    description: string;
    quantity: string;
    unitPrice: Money;
    total: Money;
  }>;
  subtotal: Money;
  discounts: Array<{ label: string; amount: Money }>;
  taxes: Array<{ label: string; rate: string; amount: Money }>;
  total: Money;
  payments: Array<{ at: string; method: string; amount: Money; reference?: string }>;
  balanceDue: Money;
  notes?: string;
  proposalReference?: string;
}

// ---------------------------------------------------------------- signature audit certificate

export interface SignatureCertificateSnapshot {
  kind: 'signature_certificate';
  meta: DocumentMeta;
  envelopeId: string;
  documentTitle: string;
  /** SHA-256 of the signed original, hex. */
  documentSha256: string;
  provider: string;
  status: 'completed' | 'partially_signed' | 'declined' | 'expired' | 'voided';
  signers: Array<{
    order: number;
    name: string;
    email: string;
    role: string;
    status: 'signed' | 'pending' | 'declined';
    consentText?: string;
    signedAt?: string;
    ipAddress?: string;
    userAgent?: string;
    identityEvidence?: string;
  }>;
  events: Array<{ sequence: number; at: string; type: string; actor: string; detail?: string }>;
}

// ---------------------------------------------------------------- roof photo inspection report
export interface InspectionMarkerSnapshot {
  id: string;
  /** Position on the photo, 0..1 from the left / top. */
  x: number;
  y: number;
  findingLabel: string;
  severity: 'minor' | 'moderate' | 'severe';
  result: 'pass' | 'monitor' | 'fail';
  note: string;
  /** Null means not yet priced (never invented). */
  price: Money | null;
}

export interface InspectionPhotoSnapshot {
  id: string;
  name: string;
  /** Data URI or absolute file path of the photo, when available. */
  imageSrc?: string;
  markers: InspectionMarkerSnapshot[];
}

export interface RoofInspectionSnapshot {
  kind: 'roof_inspection';
  meta: DocumentMeta;
  customer: { name: string; addressLines: string[] };
  inspector: string;
  /** ISO date (yyyy-mm-dd) the inspection was done. */
  inspectionDate: string;
  photos: InspectionPhotoSnapshot[];
  disclaimers: string[];
}

export interface LandReportFactorSnapshot {
  label: string;
  /** 0-100, or null when unknown (printed as "Not scored", never 0). */
  score: number | null;
  weightPercent: number;
  detail: string;
}

/** Land Scout due-diligence report for one parcel. Every value carries its source. */
export interface LandReportSnapshot {
  kind: 'land_report';
  meta: DocumentMeta;
  countyLabel: string;
  parcelId: string;
  situsAddress: string | null;
  ownerName: string | null;
  ownerMailing: string | null;
  ownerIsEntity: boolean;
  acres: number | null;
  appraisalUse: string | null;
  landValueText: string | null;
  marketValueText: string | null;
  highwayText: string | null;
  substationText: string | null;
  floodText: string | null;
  terrainSummary: string | null;
  vintage: string | null;
  source: string;
  totalScore: number | null;
  factorsKnown: number;
  factors: LandReportFactorSnapshot[];
  redFlags: string[];
  sosLookupUrl: string;
  generatedAt: string;
  disclaimers: string[];
}

/** Plan-to-Bid draft bid package. Amounts are in cents; null means unpriced (never 0). */
export interface BidPackageLineSnapshot {
  trade: string;
  tradeLabel: string;
  label: string;
  unit: string;
  quantity: number | null;
  unitPriceCents: number | null;
  amountCents: number | null;
  priceSource: string | null;
  approved: boolean;
}

export interface BidPackageTradeCostSnapshot {
  tradeLabel: string;
  laborHours: number | null;
  laborRateCents: number | null;
  subcontractorCents: number | null;
  amountCents: number;
}

export interface BidPackageSnapshot {
  kind: 'bid_package';
  meta: DocumentMeta;
  projectName: string;
  lines: BidPackageLineSnapshot[];
  tradeCosts: BidPackageTradeCostSnapshot[];
  materialTotalCents: number;
  laborTotalCents: number;
  subcontractorTotalCents: number;
  /** Null when any approved line is unpriced — the total is then partial. */
  totalCents: number | null;
  unpricedLines: number;
  approvedLines: number;
  notes: string[];
}

export interface TakeoffMarkupSnapshot {
  kind: 'takeoff_markup';
  meta: DocumentMeta;
  planTitle: string;
  sheetLabel: string;
  revisionLabel: string;
  scaleLabel: string;
  approvedCount: number;
  totals: Array<{ layer: 'length' | 'area' | 'count'; quantity: string; unit: string }>;
  drawing: {
    width: number;
    height: number;
    image: string;
    marks: Array<
      | { id: string; kind: 'length' | 'area'; path: string }
      | {
          id: string;
          kind: 'count';
          x: number;
          y: number;
          symbol: 'circle' | 'square' | 'triangle' | 'cross';
        }
    >;
  };
}

// ---------------------------------------------------------------- GIS workbench plan sheet

export interface MapPlanSheetLegendEntry {
  label: string;
  /** CSS hex color of the layer as drawn on the map. */
  color: string;
}

export interface MapPlanSheetLayerLine {
  label: string;
  featureCount: number;
  status: string;
}

/**
 * A printed map plan sheet from the GIS Workbench: the captured map view in a frame, with the
 * legend of visible layers, a scale bar (approximate at the map centre), a north arrow rotated
 * by the map bearing, and the publishers' source notes. Always labelled DRAFT — a plan sheet
 * for planning, never a survey.
 */
export interface MapPlanSheetSnapshot {
  kind: 'map_plan_sheet';
  meta: DocumentMeta;
  title: string;
  pageSize: 'LETTER' | 'LEGAL' | 'TABLOID';
  orientation: 'portrait' | 'landscape';
  /** PNG data URI of the workbench map view at export time. */
  mapImageDataUrl: string;
  centerLat: number;
  centerLon: number;
  zoom: number;
  /** Map bearing in degrees (0 = north up). */
  bearing: number;
  /** Scale-bar caption, e.g. "500 ft" — approximate at the map centre. */
  scaleBarLabel: string;
  /** Scale-bar width as a fraction of the map frame width (0..1). */
  scaleBarWidthFraction: number;
  legend: MapPlanSheetLegendEntry[];
  layerSummary: MapPlanSheetLayerLine[];
  sourceNotes: string[];
}

// ---------------------------------------------------------------- concept site plan

/** A rectangle in parcel feet: x along the street frontage, z back from the street edge. */
export interface ConceptSitePlanRect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface ConceptSitePlanLot {
  number: number;
  rect: ConceptSitePlanRect;
  areaSqft: number;
  /** Home footprint placed inside the lot, parcel feet; null when no home fits. */
  home: ConceptSitePlanRect | null;
  /** True when the lot breaks no hard zoning rule in the feasibility run. */
  passes: boolean;
  /** True when the lot carries any rule warning (e.g. flood zone). */
  hasIssues: boolean;
}

/**
 * A "Concept for Discussion" site-plan sheet from a land-feasibility run: the numbered lot
 * plan with home footprints, the exit plan, and the underwriting summary. All figures are
 * computed by the client run that produced them (the server renders them verbatim, like the
 * saved-project summaries) and are estimates from the builder's own inputs. Always labelled
 * a concept — never a survey, plat or zoning approval.
 */
export interface ConceptSitePlanSnapshot {
  kind: 'concept_site_plan';
  meta: DocumentMeta;
  projectName: string;
  parcelWidthFt: number;
  parcelDepthFt: number;
  acres: number;
  /** The new street through the parcel, parcel feet; null for one row on the existing street. */
  road: ConceptSitePlanRect | null;
  lots: ConceptSitePlanLot[];
  /** The house footprint used in the run, when one was placed. */
  homeFootprint: { widthFt: number; depthFt: number } | null;
  exitPlanLabel: string;
  /** Underwriting summary, pre-formatted by the client (label + amount text). */
  summaryLines: Array<{ label: string; value: string }>;
  /** Infrastructure and pricing assumptions printed on the sheet. */
  assumptions: string[];
  disclaimers: string[];
}

export type AnySnapshot =
  | RoofReportSnapshot
  | CurbEstimateSnapshot
  | ProposalSnapshot
  | InvoiceSnapshot
  | SignatureCertificateSnapshot
  | RoofInspectionSnapshot
  | LandReportSnapshot
  | BidPackageSnapshot
  | TakeoffMarkupSnapshot
  | MapPlanSheetSnapshot
  | ConceptSitePlanSnapshot;

export type TemplateKind = AnySnapshot['kind'];
