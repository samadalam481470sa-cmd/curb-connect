// Typed field contracts for the highest-frequency Enterprise blueprint records.
//
// The blueprint catalog still carries the human-readable field labels. This file adds the machine
// contract: value type, requiredness, enum options, reference target and server-computed formulas.
// Money is stored in integer minor units (US cents) to match the rest of the platform; dates are
// ISO calendar dates (YYYY-MM-DD). Computed fields are derived on the server and are never accepted
// from a client.
import { workPackageFieldKey, type EnterpriseWorkPackage } from './enterpriseBlueprint';

export type EnterpriseFieldType =
  'text' | 'money' | 'number' | 'date' | 'enum' | 'reference' | 'computed';

export type EnterpriseFieldValue = string | number;
export type EnterpriseFieldValues = Record<string, EnterpriseFieldValue>;

export interface EnterpriseFieldOption {
  readonly value: string;
  readonly label: string;
}

interface EnterpriseFieldBase {
  readonly key: string;
  readonly label: string;
  readonly required?: boolean;
  readonly help?: string;
}

export interface EnterpriseTextField extends EnterpriseFieldBase {
  readonly type: 'text';
  readonly maxLength?: number;
}

export interface EnterpriseMoneyField extends EnterpriseFieldBase {
  readonly type: 'money';
  readonly minMinor?: number;
  readonly maxMinor?: number;
}

export interface EnterpriseNumberField extends EnterpriseFieldBase {
  readonly type: 'number';
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface EnterpriseDateField extends EnterpriseFieldBase {
  readonly type: 'date';
  readonly min?: string;
  readonly max?: string;
}

export interface EnterpriseEnumField extends EnterpriseFieldBase {
  readonly type: 'enum';
  readonly options: readonly EnterpriseFieldOption[];
}

export interface EnterpriseReferenceField extends EnterpriseFieldBase {
  readonly type: 'reference';
  readonly target: 'project' | 'user' | 'record';
  /** For a record reference, constrain it to these work-package codes. */
  readonly packageCodes?: readonly string[];
}

export type EnterpriseComputation =
  | {
      readonly op: 'add' | 'subtract' | 'multiply' | 'divide';
      readonly inputs: readonly string[];
      readonly round?: 'round' | 'floor' | 'ceil' | 'none';
      /** Optional numeric inputs that count as zero when the record omits them. */
      readonly defaults?: Readonly<Record<string, number>>;
    }
  | {
      readonly op: 'percent_of';
      readonly value: string;
      readonly percent: string;
      readonly round?: 'round' | 'floor' | 'ceil' | 'none';
      readonly defaults?: Readonly<Record<string, number>>;
    }
  | { readonly op: 'days_between'; readonly from: string; readonly to: string }
  | {
      readonly op: 'sum';
      readonly terms: readonly { readonly field: string; readonly factor: number }[];
      readonly round?: 'round' | 'floor' | 'ceil' | 'none';
      readonly defaults?: Readonly<Record<string, number>>;
    };

export interface EnterpriseComputedField extends EnterpriseFieldBase {
  readonly type: 'computed';
  readonly format: 'money' | 'number' | 'percent';
  readonly compute: EnterpriseComputation;
}

export type EnterpriseFieldDefinition =
  | EnterpriseTextField
  | EnterpriseMoneyField
  | EnterpriseNumberField
  | EnterpriseDateField
  | EnterpriseEnumField
  | EnterpriseReferenceField
  | EnterpriseComputedField;

export interface EnterpriseFieldSchema {
  readonly packageCode: string;
  readonly fields: readonly EnterpriseFieldDefinition[];
}

export const ENTERPRISE_TYPED_PACKAGE_CODES = [
  '007',
  '009',
  '014',
  '028',
  '039',
  '040',
  '046',
  '048',
  '072',
  '074',
] as const;

export type EnterpriseTypedPackageCode = (typeof ENTERPRISE_TYPED_PACKAGE_CODES)[number];

const LEAD_SOURCES = [
  { value: 'web', label: 'Website form' },
  { value: 'referral', label: 'Referral' },
  { value: 'import', label: 'Imported list' },
  { value: 'event', label: 'Event or walk-in' },
  { value: 'other', label: 'Other' },
] as const;

const CONSENT_STATES = [
  { value: 'granted', label: 'Granted' },
  { value: 'pending', label: 'Pending' },
  { value: 'declined', label: 'Declined' },
] as const;

const IMPACT_KINDS = [
  { value: 'none', label: 'No impact' },
  { value: 'cost', label: 'Cost impact' },
  { value: 'schedule', label: 'Schedule impact' },
  { value: 'both', label: 'Cost and schedule' },
] as const;

const PROJECT_TYPES = [
  { value: 'residential', label: 'Residential' },
  { value: 'multifamily', label: 'Multifamily' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'remodel', label: 'Remodel' },
] as const;

const SCHEMAS: Record<string, EnterpriseFieldSchema> = {
  '007': {
    packageCode: '007',
    fields: [
      { key: 'name', label: 'Lead name', type: 'text', required: true, maxLength: 255 },
      { key: 'contact', label: 'Contact', type: 'text', maxLength: 255 },
      { key: 'source', label: 'Source', type: 'enum', required: true, options: LEAD_SOURCES },
      { key: 'community', label: 'Community', type: 'text', maxLength: 255 },
      { key: 'consent', label: 'Consent', type: 'enum', options: CONSENT_STATES },
      { key: 'captured-on', label: 'Captured on', type: 'date' },
      { key: 'assigned-to', label: 'Assigned to', type: 'reference', target: 'user' },
    ],
  },
  '009': {
    packageCode: '009',
    fields: [
      {
        key: 'lead',
        label: 'Lead',
        type: 'reference',
        target: 'record',
        packageCodes: ['007'],
        required: true,
      },
      { key: 'budget', label: 'Budget', type: 'money', required: true, minMinor: 0 },
      { key: 'community', label: 'Community', type: 'text', maxLength: 255 },
      {
        key: 'probability',
        label: 'Probability',
        type: 'number',
        required: true,
        min: 0,
        max: 100,
        step: 1,
        help: 'Whole percentage, 0–100.',
      },
      { key: 'owner', label: 'Owner', type: 'reference', target: 'user', required: true },
      { key: 'close-date', label: 'Target close date', type: 'date' },
      {
        key: 'weighted-value',
        label: 'Weighted pipeline value',
        type: 'computed',
        format: 'money',
        compute: { op: 'percent_of', value: 'budget', percent: 'probability' },
      },
    ],
  },
  '014': {
    packageCode: '014',
    fields: [
      { key: 'lot', label: 'Lot', type: 'text', maxLength: 120 },
      { key: 'plan', label: 'Plan', type: 'text', maxLength: 120 },
      { key: 'option-package', label: 'Option package', type: 'text', maxLength: 255 },
      { key: 'price', label: 'Price', type: 'money', required: true, minMinor: 0 },
      { key: 'expiry', label: 'Expires on', type: 'date', required: true },
      { key: 'discount', label: 'Discount', type: 'money', minMinor: 0 },
      {
        key: 'net-price',
        label: 'Net price',
        type: 'computed',
        format: 'money',
        compute: { op: 'subtract', inputs: ['price', 'discount'], defaults: { discount: 0 } },
      },
    ],
  },
  '028': {
    packageCode: '028',
    fields: [
      {
        key: 'signed-contract',
        label: 'Signed contract',
        type: 'reference',
        target: 'record',
        packageCodes: ['014'],
      },
      { key: 'lot', label: 'Lot', type: 'text', maxLength: 120 },
      { key: 'plan', label: 'Plan', type: 'text', maxLength: 120 },
      {
        key: 'manager',
        label: 'Project manager',
        type: 'reference',
        target: 'user',
        required: true,
      },
      {
        key: 'template-version',
        label: 'Template version',
        type: 'text',
        required: true,
        maxLength: 80,
      },
      { key: 'project-type', label: 'Project type', type: 'enum', options: PROJECT_TYPES },
      { key: 'start-date', label: 'Start date', type: 'date' },
      { key: 'target-completion', label: 'Target completion', type: 'date' },
    ],
  },
  '039': {
    packageCode: '039',
    fields: [
      { key: 'question', label: 'Question', type: 'text', required: true, maxLength: 10000 },
      { key: 'drawing-revision', label: 'Drawing revision', type: 'text', maxLength: 80 },
      { key: 'impact', label: 'Impact', type: 'enum', options: IMPACT_KINDS },
      { key: 'responder', label: 'Responder', type: 'reference', target: 'user', required: true },
      { key: 'due-date', label: 'Due date', type: 'date', required: true },
      { key: 'project', label: 'Project', type: 'reference', target: 'project', required: true },
      { key: 'opened-on', label: 'Opened on', type: 'date', required: true },
      { key: 'answered-on', label: 'Answered on', type: 'date' },
      {
        key: 'days-open',
        label: 'Days open',
        type: 'computed',
        format: 'number',
        compute: { op: 'days_between', from: 'opened-on', to: 'answered-on' },
      },
    ],
  },
  '040': {
    packageCode: '040',
    fields: [
      { key: 'spec-section', label: 'Spec section', type: 'text', required: true, maxLength: 50 },
      { key: 'product-data', label: 'Product data', type: 'text', maxLength: 2000 },
      { key: 'reviewer', label: 'Reviewer', type: 'reference', target: 'user', required: true },
      { key: 'required-date', label: 'Required date', type: 'date', required: true },
      { key: 'project', label: 'Project', type: 'reference', target: 'project', required: true },
      { key: 'submitted-on', label: 'Submitted on', type: 'date' },
      { key: 'approval-date', label: 'Approval date', type: 'date' },
      { key: 'review-cycle', label: 'Review cycle', type: 'number', min: 1, step: 1 },
    ],
  },
  '046': {
    packageCode: '046',
    fields: [
      { key: 'vendor', label: 'Vendor', type: 'text', required: true, maxLength: 255 },
      { key: 'project', label: 'Project', type: 'reference', target: 'project', required: true },
      { key: 'sku', label: 'SKU', type: 'text', required: true, maxLength: 80 },
      { key: 'quantity', label: 'Quantity', type: 'number', required: true, min: 0, step: 0.01 },
      { key: 'unit-cost', label: 'Unit cost', type: 'money', required: true, minMinor: 0 },
      { key: 'delivery-date', label: 'Delivery date', type: 'date', required: true },
      {
        key: 'total',
        label: 'Order total',
        type: 'computed',
        format: 'money',
        compute: { op: 'multiply', inputs: ['quantity', 'unit-cost'] },
      },
    ],
  },
  '048': {
    packageCode: '048',
    fields: [
      { key: 'scope-delta', label: 'Scope delta', type: 'text', required: true, maxLength: 10000 },
      {
        key: 'schedule-impact',
        label: 'Schedule impact (days)',
        type: 'number',
        min: -3650,
        max: 3650,
        step: 1,
      },
      { key: 'price', label: 'Price change', type: 'money', required: true },
      {
        key: 'approval-authority',
        label: 'Approval authority',
        type: 'reference',
        target: 'user',
        required: true,
      },
      { key: 'project', label: 'Project', type: 'reference', target: 'project', required: true },
      {
        key: 'original-contract',
        label: 'Original contract value',
        type: 'money',
        required: true,
        minMinor: 0,
      },
      { key: 'approval-date', label: 'Approval date', type: 'date' },
      {
        key: 'revised-contract',
        label: 'Revised contract value',
        type: 'computed',
        format: 'money',
        compute: { op: 'add', inputs: ['original-contract', 'price'] },
      },
    ],
  },
  '072': {
    packageCode: '072',
    fields: [
      { key: 'vendor', label: 'Vendor', type: 'text', required: true, maxLength: 255 },
      {
        key: 'invoice-number',
        label: 'Invoice number',
        type: 'text',
        required: true,
        maxLength: 80,
      },
      {
        key: 'po',
        label: 'Purchase order',
        type: 'reference',
        target: 'record',
        packageCodes: ['046'],
      },
      { key: 'amount', label: 'Amount', type: 'money', required: true, minMinor: 0 },
      { key: 'tax', label: 'Tax', type: 'money', minMinor: 0 },
      { key: 'due-date', label: 'Due date', type: 'date', required: true },
      { key: 'invoice-date', label: 'Invoice date', type: 'date', required: true },
      { key: 'paid', label: 'Paid', type: 'money', minMinor: 0 },
      { key: 'project', label: 'Project', type: 'reference', target: 'project' },
      {
        key: 'balance-due',
        label: 'Balance due',
        type: 'computed',
        format: 'money',
        compute: {
          op: 'sum',
          terms: [
            { field: 'amount', factor: 1 },
            { field: 'tax', factor: 1 },
            { field: 'paid', factor: -1 },
          ],
          defaults: { tax: 0, paid: 0 },
        },
      },
    ],
  },
  '074': {
    packageCode: '074',
    fields: [
      {
        key: 'contract-value',
        label: 'Contract value',
        type: 'money',
        required: true,
        minMinor: 0,
      },
      {
        key: 'completed-percentage',
        label: 'Completed percentage',
        type: 'number',
        required: true,
        min: 0,
        max: 100,
        step: 0.01,
      },
      { key: 'stored-materials', label: 'Stored materials', type: 'money', minMinor: 0 },
      {
        key: 'retainage-rate',
        label: 'Retainage rate',
        type: 'number',
        required: true,
        min: 0,
        max: 100,
        step: 0.01,
        help: 'Percentage of completed work withheld, 0–100.',
      },
      { key: 'project', label: 'Project', type: 'reference', target: 'project', required: true },
      { key: 'period-end', label: 'Period end', type: 'date', required: true },
      {
        key: 'completed-to-date',
        label: 'Completed to date',
        type: 'computed',
        format: 'money',
        compute: { op: 'percent_of', value: 'contract-value', percent: 'completed-percentage' },
      },
      {
        key: 'retainage',
        label: 'Retainage',
        type: 'computed',
        format: 'money',
        compute: { op: 'percent_of', value: 'completed-to-date', percent: 'retainage-rate' },
      },
      {
        key: 'net-due',
        label: 'Net due',
        type: 'computed',
        format: 'money',
        compute: {
          op: 'sum',
          terms: [
            { field: 'completed-to-date', factor: 1 },
            { field: 'stored-materials', factor: 1 },
            { field: 'retainage', factor: -1 },
          ],
          defaults: { 'stored-materials': 0 },
        },
      },
    ],
  },
};

export function enterpriseFieldSchema(code: string): EnterpriseFieldSchema | undefined {
  return SCHEMAS[code];
}

export function enterpriseFieldDefinition(
  code: string,
  key: string,
): EnterpriseFieldDefinition | undefined {
  return enterpriseFieldSchema(code)?.fields.find((field) => field.key === key);
}

export function isEnterpriseTypedPackage(code: string): boolean {
  return enterpriseFieldSchema(code) !== undefined;
}

/** True when every field label in the catalog has a typed definition (new fields are allowed). */
export function typedSchemaCoversCatalog(
  pkg: EnterpriseWorkPackage,
  schema: EnterpriseFieldSchema,
): boolean {
  const keys = new Set(schema.fields.map((field) => field.key));
  return pkg.fields.every((label) => keys.has(workPackageFieldKey(label)));
}

function rounded(value: number, mode: 'round' | 'floor' | 'ceil' | 'none' = 'round'): number {
  if (mode === 'floor') return Math.floor(value);
  if (mode === 'ceil') return Math.ceil(value);
  if (mode === 'none') return value;
  return Math.round(value);
}

function numeric(
  values: EnterpriseFieldValues,
  key: string,
  defaults?: Readonly<Record<string, number>>,
): number | null {
  const value = values[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return defaults?.[key] ?? null;
}

function isoDay(value: EnterpriseFieldValue | undefined): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Evaluates one computed field from already-typed inputs. Returns null when inputs are missing. */
export function computeEnterpriseFieldValue(
  field: EnterpriseComputedField,
  values: EnterpriseFieldValues,
): number | null {
  const c = field.compute;
  if (c.op === 'days_between') {
    const from = isoDay(values[c.from]);
    const to = isoDay(values[c.to]);
    if (from === null || to === null) return null;
    return Math.floor((to - from) / 86_400_000);
  }
  if (c.op === 'percent_of') {
    const value = numeric(values, c.value, c.defaults);
    const percent = numeric(values, c.percent, c.defaults);
    if (value === null || percent === null) return null;
    return rounded((value * percent) / 100, c.round);
  }
  if (c.op === 'sum') {
    let total = 0;
    for (const term of c.terms) {
      const value = numeric(values, term.field, c.defaults);
      if (value === null) return null;
      total += value * term.factor;
    }
    return rounded(total, c.round);
  }
  const [leftKey, rightKey] = c.inputs;
  if (!leftKey || !rightKey) return null;
  const left = numeric(values, leftKey, c.defaults);
  const right = numeric(values, rightKey, c.defaults);
  if (left === null || right === null) return null;
  if (c.op === 'add') return rounded(left + right, c.round);
  if (c.op === 'subtract') return rounded(left - right, c.round);
  if (c.op === 'multiply') return rounded(left * right, c.round);
  if (right === 0) return null;
  return rounded(left / right, c.round);
}

/** Recomputes every computed field in schema order (later formulas may use earlier results). */
export function computeEnterpriseFieldValues(
  schema: EnterpriseFieldSchema,
  values: EnterpriseFieldValues,
): EnterpriseFieldValues {
  const next: EnterpriseFieldValues = { ...values };
  for (const field of schema.fields) {
    if (field.type !== 'computed') continue;
    const result = computeEnterpriseFieldValue(field, next);
    if (result === null) delete next[field.key];
    else next[field.key] = result;
  }
  return next;
}
