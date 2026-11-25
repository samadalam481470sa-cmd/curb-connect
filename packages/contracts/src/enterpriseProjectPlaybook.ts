// Project playbooks select a focused subset of the Enterprise blueprint catalog for a project.
//
// The package selections are planning guidance, not new persistence. The API joins them to the
// tenant's existing work-package records so a project sees which required records exist, who owns
// them, whether they are blocked or late, and what the next action is.

export const ENTERPRISE_PROJECT_TYPE_KEYS = [
  'residential',
  'multifamily',
  'commercial',
  'remodel',
  'land-development',
] as const;

export type EnterpriseProjectTypeKey = (typeof ENTERPRISE_PROJECT_TYPE_KEYS)[number];

export interface EnterpriseProjectTypeDefinition {
  readonly key: EnterpriseProjectTypeKey;
  readonly label: string;
  readonly description: string;
}

export const ENTERPRISE_PROJECT_TYPES: readonly EnterpriseProjectTypeDefinition[] = [
  {
    key: 'residential',
    label: 'Residential',
    description: 'Custom or production home construction, including community and plan selection.',
  },
  {
    key: 'multifamily',
    label: 'Multifamily',
    description: 'Apartment, townhome and mixed-use communities with shared building systems.',
  },
  {
    key: 'commercial',
    label: 'Commercial',
    description:
      'Commercial buildings and tenant improvements with coordinated design and permits.',
  },
  {
    key: 'remodel',
    label: 'Remodel',
    description: 'Renovation and improvement work in an existing building.',
  },
  {
    key: 'land-development',
    label: 'Land development',
    description: 'Land acquisition, entitlements, subdivision infrastructure and lot release.',
  },
];

export const ENTERPRISE_PLAYBOOK_PHASE_KEYS = [
  'planning',
  'preconstruction',
  'construction',
  'closeout',
] as const;

export type EnterprisePlaybookPhaseKey = (typeof ENTERPRISE_PLAYBOOK_PHASE_KEYS)[number];

export interface EnterprisePlaybookPhaseDefinition {
  readonly key: EnterprisePlaybookPhaseKey;
  readonly label: string;
  readonly description: string;
  readonly gateLabel: string;
  readonly gateDescription: string;
}

export const ENTERPRISE_PLAYBOOK_PHASES: readonly EnterprisePlaybookPhaseDefinition[] = [
  {
    key: 'planning',
    label: 'Plan & design',
    description: 'Define the project, scope, estimate, schedule basis and design inputs.',
    gateLabel: 'Plan approval gate',
    gateDescription: 'The project has an approved basis of scope, cost, schedule and design.',
  },
  {
    key: 'preconstruction',
    label: 'Preconstruction',
    description: 'Permit, procure, award commitments and release the work to the field.',
    gateLabel: 'Field release gate',
    gateDescription: 'Permits, submittals, procurement and commitments are ready for mobilization.',
  },
  {
    key: 'construction',
    label: 'Construction',
    description:
      'Execute field work with current logs, inspections, RFIs, safety and cost controls.',
    gateLabel: 'Substantial completion gate',
    gateDescription: 'Field work and quality controls are complete enough to start closeout.',
  },
  {
    key: 'closeout',
    label: 'Closeout & turnover',
    description: 'Clear punch work, close the financials and hand over the completed project.',
    gateLabel: 'Closeout gate',
    gateDescription: 'Punch work, billing, lien releases and turnover are complete.',
  },
];

const CORE_PLANNING = ['028', '031', '032', '051', '052'] as const;
const CORE_PRECONSTRUCTION = ['038', '040', '043', '044', '045', '046', '150'] as const;
const CORE_CONSTRUCTION = ['035', '036', '037', '039', '048', '049'] as const;
const CORE_CLOSEOUT = ['041', '071', '073', '074', '075', '146'] as const;

/**
 * Required blueprint packages by project type and delivery phase. Code order is the suggested
 * order of work inside each phase.
 */
export const ENTERPRISE_PLAYBOOK_CODES: Record<
  EnterpriseProjectTypeKey,
  Record<EnterprisePlaybookPhaseKey, readonly string[]>
> = {
  residential: {
    planning: ['017', '018', '019', '023', ...CORE_PLANNING, '148'],
    preconstruction: [...CORE_PRECONSTRUCTION],
    construction: [...CORE_CONSTRUCTION, '141', '142', '143', '144', '145'],
    closeout: [...CORE_CLOSEOUT],
  },
  multifamily: {
    planning: ['017', '018', '019', '023', '030', ...CORE_PLANNING, '148'],
    preconstruction: [...CORE_PRECONSTRUCTION],
    construction: [...CORE_CONSTRUCTION, '145'],
    closeout: [...CORE_CLOSEOUT],
  },
  commercial: {
    planning: [...CORE_PLANNING, '148'],
    preconstruction: [...CORE_PRECONSTRUCTION],
    construction: [...CORE_CONSTRUCTION, '145'],
    closeout: [...CORE_CLOSEOUT],
  },
  remodel: {
    planning: [...CORE_PLANNING],
    preconstruction: [...CORE_PRECONSTRUCTION],
    construction: [...CORE_CONSTRUCTION, '143', '144'],
    closeout: [...CORE_CLOSEOUT],
  },
  'land-development': {
    planning: ['029', '136', '137', ...CORE_PLANNING],
    preconstruction: [...CORE_PRECONSTRUCTION],
    construction: ['035', '036', '037', '049', '138', '139'],
    closeout: [...CORE_CLOSEOUT],
  },
};

export interface EnterprisePlaybookSelection {
  readonly packageCode: string;
  readonly phase: EnterprisePlaybookPhaseKey;
}

export function enterpriseProjectType(
  key: EnterpriseProjectTypeKey,
): EnterpriseProjectTypeDefinition {
  return ENTERPRISE_PROJECT_TYPES.find((type) => type.key === key)!;
}

export function enterprisePlaybookPhase(
  key: EnterprisePlaybookPhaseKey,
): EnterprisePlaybookPhaseDefinition {
  return ENTERPRISE_PLAYBOOK_PHASES.find((phase) => phase.key === key)!;
}

/** All required packages for a project type, optionally narrowed to one phase. */
export function enterprisePlaybookSelection(
  projectType: EnterpriseProjectTypeKey,
  phase?: EnterprisePlaybookPhaseKey,
): EnterprisePlaybookSelection[] {
  const phases = phase ? [enterprisePlaybookPhase(phase)] : ENTERPRISE_PLAYBOOK_PHASES;
  return phases.flatMap((definition) =>
    ENTERPRISE_PLAYBOOK_CODES[projectType][definition.key].map((packageCode) => ({
      packageCode,
      phase: definition.key,
    })),
  );
}
