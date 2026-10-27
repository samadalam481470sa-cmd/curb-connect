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
  /** Organization (tenant) printing the document: the contractor, never Fieldline itself. */
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

export type AnySnapshot =
  | RoofReportSnapshot
  | CurbEstimateSnapshot
  | ProposalSnapshot
  | InvoiceSnapshot
  | SignatureCertificateSnapshot;

export type TemplateKind = AnySnapshot['kind'];
