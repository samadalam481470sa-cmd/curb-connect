/**
 * Test and preview fixtures. Clearly fictional data (example.test addresses, sample companies).
 * The curb fixture reproduces the page-60 golden pricing case: direct $3,744.00, +10% overhead
 * $4,118.40, 25% target margin -> $5,491.20 before tax.
 */
import type {
  CurbEstimateSnapshot,
  DocumentMeta,
  InvoiceSnapshot,
  ProposalSnapshot,
  RoofReportSnapshot,
  SignatureCertificateSnapshot,
} from './snapshots';

const usd = (amountMinor: number) => ({ amountMinor, currency: 'USD' });

const meta = (documentId: string): DocumentMeta => ({
  documentId,
  revision: 2,
  issuedAt: '2026-10-20T15:30:00.000Z',
  timeZone: 'UTC',
  locale: 'en-US',
  organization: {
    name: 'Sample Roofing & Concrete Co.',
    phone: '555-0100',
    email: 'office@example.test',
    licenseNumber: 'SAMPLE-123',
  },
  productName: 'Fieldline',
});

const PITCH_6 = Math.sqrt(1 + (6 / 12) ** 2);

export const roofReportFixture: RoofReportSnapshot = {
  kind: 'roof_report',
  meta: meta('RPT-2026-000123'),
  property: { addressLines: ['100 Example Lane', 'Springfield, ST 00000'], parcelId: 'PCL-0001' },
  measurementSystem: 'imperial',
  imagery: {
    provider: 'Sample Imagery Ltd',
    captureDate: '2026-05-01',
    gsdMeters: 0.075,
    licenseId: 'LIC-77',
    exportAllowed: false,
  },
  structures: [
    {
      id: 'st-1',
      name: 'Main house',
      wasteFactor: 0.1,
      facets: [
        {
          id: 'f-a',
          label: 'A',
          polygon: [
            [0, 0],
            [10, 0],
            [10, 3],
            [0, 3],
          ],
          planAreaSqM: 30,
          slopedAreaSqM: 30 * PITCH_6,
          pitchRisePer12: 6,
          provenance: 'field_verified',
        },
        {
          id: 'f-b',
          label: 'B',
          polygon: [
            [0, 3],
            [10, 3],
            [10, 6],
            [0, 6],
          ],
          planAreaSqM: 30,
          slopedAreaSqM: 30 * PITCH_6,
          pitchRisePer12: 6,
          provenance: 'imagery_derived',
        },
      ],
      edges: [
        {
          id: 'e1',
          category: 'ridge',
          lengthM: 10,
          from: [0, 3],
          to: [10, 3],
          provenance: 'imagery_derived',
        },
        {
          id: 'e2',
          category: 'eave',
          lengthM: 20,
          from: [0, 0],
          to: [10, 0],
          provenance: 'imagery_derived',
        },
        {
          id: 'e3',
          category: 'rake',
          lengthM: 4 * 3 * PITCH_6,
          from: [0, 0],
          to: [0, 6],
          provenance: 'imagery_derived',
        },
      ],
    },
    {
      id: 'st-2',
      name: 'Garage',
      wasteFactor: 0.12,
      facets: [
        {
          id: 'g-a',
          label: 'G1',
          polygon: [
            [0, 0],
            [6, 0],
            [6, 5],
            [0, 5],
          ],
          planAreaSqM: 30,
          slopedAreaSqM: 30,
          pitchRisePer12: 0,
          provenance: 'user_entered',
        },
      ],
      edges: [
        {
          id: 'g-e1',
          category: 'eave',
          lengthM: 22,
          from: [0, 0],
          to: [6, 0],
          provenance: 'user_entered',
        },
      ],
    },
  ],
  exclusions: ['Detached shed not measured', 'Skylights excluded from area'],
  reviewNotes: [
    {
      author: 'R. Reviewer',
      at: '2026-10-19T12:00:00.000Z',
      text: 'Facet B from imagery; verify on site.',
    },
  ],
  methodology:
    'Each facet is digitized separately from licensed imagery or entered by a person. Sloped area = plan area × √(1 + pitch²). Waste is applied once per structure.',
  disclaimers: ['Measurements are estimates unless marked measured.', 'Not a survey.'],
  approval: {
    status: 'approved',
    approverName: 'R. Reviewer',
    approverRole: 'Estimator lead',
    approvedAt: '2026-10-20T15:00:00.000Z',
  },
};

export const curbEstimateFixture: CurbEstimateSnapshot = {
  kind: 'curb_estimate',
  meta: meta('EST-2026-000045'),
  site: {
    addressLines: ['200 Sample Street', 'Springfield, ST 00000'],
    jurisdiction: 'City of Springfield',
  },
  binding: false,
  scenarios: { low: usd(470000), base: usd(549120), high: usd(680000) },
  lines: [
    {
      id: 'l1',
      category: '01_mobilization',
      description: 'Mobilization',
      quantity: '1',
      unit: 'ea',
      unitPrice: usd(40000),
      total: usd(40000),
      provenance: 'user_entered',
    },
    {
      id: 'l2',
      category: '02_cutting',
      description: 'Saw cut curb',
      quantity: '18',
      unit: 'ft',
      unitPrice: usd(2000),
      total: usd(36000),
      provenance: 'machine_estimated',
    },
    {
      id: 'l3',
      category: '03_demolition',
      description: 'Breakout and removal',
      quantity: '18',
      unit: 'ft',
      unitPrice: usd(2800),
      total: usd(50400),
      provenance: 'machine_estimated',
    },
    {
      id: 'l4',
      category: '04_disposal',
      description: 'Disposal',
      quantity: '1',
      unit: 'load',
      unitPrice: usd(22000),
      total: usd(22000),
      provenance: 'user_entered',
    },
    {
      id: 'l5',
      category: '05_restoration',
      description: 'Replacement curb and apron',
      quantity: '18',
      unit: 'ft',
      unitPrice: usd(9500),
      total: usd(171000),
      provenance: 'machine_estimated',
    },
    {
      id: 'l6',
      category: '06_traffic',
      description: 'Traffic control',
      quantity: '1',
      unit: 'day',
      unitPrice: usd(35000),
      total: usd(35000),
      provenance: 'user_entered',
    },
    {
      id: 'l7',
      category: '07_permits',
      description: 'Permit allowance',
      quantity: '1',
      unit: 'ea',
      unitPrice: usd(20000),
      total: usd(20000),
      provenance: 'user_entered',
    },
  ],
  directCost: usd(374400),
  overhead: usd(37440),
  contingency: usd(0),
  tax: usd(0),
  pricingMethod: { kind: 'target_margin', rate: '25%' },
  sellingPrice: usd(549120),
  unknowns: [{ item: 'Buried curb depth and reinforcement', impact: 'May raise breakout cost' }],
  gates: [
    { kind: 'permit', status: 'pending', note: 'Application not filed' },
    { kind: 'utility_locate', status: 'unknown' },
    { kind: 'right_of_way', status: 'pending' },
  ],
  calibration: [
    {
      photoId: 'PH-1',
      method: 'two_point_reference',
      quality: '±3 cm at 4 m',
      capturedAt: '2026-10-18T10:00:00.000Z',
    },
  ],
  priceBookRevision: 'PB-7 r3',
  engineVersion: 'pricing 0.1.0',
  validUntil: '2026-11-19T00:00:00.000Z',
  disclaimers: ['Photo-based dimensions are suggestions until field verified.'],
};

export const proposalFixture: ProposalSnapshot = {
  kind: 'proposal',
  meta: meta('PRP-2026-000010'),
  customer: { name: 'Pat Example', addressLines: ['100 Example Lane', 'Springfield, ST 00000'] },
  title: 'Roof replacement proposal',
  budgetary: false,
  options: [
    {
      id: 'o1',
      name: 'Standard',
      tier: 'standard',
      scope: ['Tear off one layer', 'Architectural shingles'],
      exclusions: ['Decking replacement beyond 2 sheets'],
      lines: [{ description: 'Roof system', total: usd(1450000) }],
      total: usd(1450000),
      warranty: '10-year workmanship',
    },
    {
      id: 'o2',
      name: 'Premium',
      tier: 'premium',
      scope: ['Tear off', 'Designer shingles', 'Ice barrier full deck'],
      exclusions: [],
      lines: [{ description: 'Roof system', total: usd(1980000) }],
      total: usd(1980000),
    },
  ],
  optionalAddOns: [{ id: 'a1', description: 'Gutter guards', total: usd(85000), selected: false }],
  selectedOptionId: 'o1',
  paymentTerms: ['30% deposit at signing', 'Balance on completion'],
  taxTreatment: 'Sales tax included in prices',
  startDateAssumption: 'Within 3 weeks of signing, weather permitting',
  validUntil: '2026-11-20T00:00:00.000Z',
  terms: ['Changes after signing require a new proposal revision.'],
};

export const invoiceFixture: InvoiceSnapshot = {
  kind: 'invoice',
  meta: meta('INV-2026-000777'),
  billTo: { name: 'Pat Example', addressLines: ['100 Example Lane'] },
  status: 'partially_paid',
  dueDate: '2026-11-05T00:00:00.000Z',
  lines: [
    {
      id: 'i1',
      description: 'Roof replacement — Standard',
      quantity: '1',
      unitPrice: usd(1450000),
      total: usd(1450000),
    },
  ],
  subtotal: usd(1450000),
  discounts: [],
  taxes: [{ label: 'Sales tax', rate: '0%', amount: usd(0) }],
  total: usd(1450000),
  payments: [
    { at: '2026-10-21T00:00:00.000Z', method: 'ACH', amount: usd(435000), reference: 'DEP-1' },
  ],
  balanceDue: usd(1015000),
  proposalReference: 'PRP-2026-000010',
};

export const signatureCertificateFixture: SignatureCertificateSnapshot = {
  kind: 'signature_certificate',
  meta: meta('CERT-2026-000003'),
  envelopeId: 'ENV-abc123',
  documentTitle: 'Roof replacement proposal PRP-2026-000010 rev 2',
  documentSha256: 'a3f1c2d4e5b60718293a4b5c6d7e8f90112233445566778899aabbccddeeff00',
  provider: 'Internal reviewed workflow (test)',
  status: 'completed',
  signers: [
    {
      order: 1,
      name: 'Pat Example',
      email: 'pat@example.test',
      role: 'Homeowner',
      status: 'signed',
      consentText: 'I agree to sign electronically.',
      signedAt: '2026-10-21T14:02:11.000Z',
      ipAddress: '203.0.113.7',
      identityEvidence: 'Email link verified',
    },
  ],
  events: [
    { sequence: 1, at: '2026-10-21T13:58:00.000Z', type: 'sent', actor: 'office@example.test' },
    { sequence: 2, at: '2026-10-21T14:01:00.000Z', type: 'viewed', actor: 'pat@example.test' },
    { sequence: 3, at: '2026-10-21T14:02:11.000Z', type: 'signed', actor: 'pat@example.test' },
  ],
};
