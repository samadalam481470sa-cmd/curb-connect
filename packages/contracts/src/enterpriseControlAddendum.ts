// FieldPro Enterprise control-level addendum v4.1.
//
// The addendum specifies 13 feature modules across 234 feature-control pages (18 per module),
// 52 granular control-matrix pages, 20 shared UI/engineering control pages and 7 cross-module
// scenarios. Each module below carries the routes, dashboard metrics and proposed entities that
// the document states, plus the 18 control gates every module must satisfy. Modules link to the
// work packages that own their data so a reader can move from the control contract to the
// operating record.
//
// This is a requirements registry, not a claim that every external integration is live. The
// Enterprise Blueprint workspace records delivery evidence against each package and control gate.

export interface EnterpriseControlModule {
  readonly key: string;
  readonly title: string;
  readonly summary: string;
  readonly routes: readonly string[];
  readonly kpis: readonly string[];
  readonly entities: readonly string[];
  readonly workPackageCodes: readonly string[];
}

export const ADDENDUM_CONTROL_GATES: readonly string[] = [
  'Product contract and business rules',
  'Roles, permissions and data visibility',
  'Routes, navigation and screen inventory',
  'Dashboard and work queues',
  'List view, toolbar and table controls',
  'Record detail page and tabs',
  'Create and edit workflow',
  'Button-by-button interaction contract',
  'Toggle, checkbox and preference contract',
  'Lifecycle and decision logic',
  'Database and data integrity',
  'API, events and permission matrix',
  'Integration and external systems',
  'Mobile and accessibility',
  'Reporting and analytics',
  'Security, privacy and audit',
  'Cross-module scenarios',
  'Acceptance tests and evidence',
];

export const ADDENDUM_COUNTS = {
  featureAreas: 13,
  featureControlPages: 234,
  controlMatrixPages: 52,
  sharedControlPages: 20,
  crossModuleScenarios: 7,
} as const;

export const ENTERPRISE_CONTROL_MODULES: readonly EnterpriseControlModule[] = [
  {
    key: 'accounting',
    title: 'Accounting with QuickBooks and external synchronization',
    summary:
      'Connect operational construction records to the accounting book without duplicate posting, preserving auditability and keeping job costs current.',
    routes: [
      '/enterprise/finance/integrations',
      '/enterprise/finance/sync-health',
      '/enterprise/finance/mappings',
      '/enterprise/finance/bills',
      '/enterprise/finance/invoices',
      '/enterprise/finance/reconciliation',
      '/enterprise/finance/period-close',
    ],
    kpis: [
      'sync success rate by entity',
      'oldest unresolved conflict',
      'unreconciled amount',
      'time from approval to external posting',
      'duplicate-prevention count',
      'period-close exception count',
    ],
    entities: [
      'accounting_connections',
      'accounting_realms',
      'accounting_entity_mappings',
      'accounting_sync_runs',
      'accounting_sync_items',
      'accounting_conflicts',
      'accounting_periods',
    ],
    workPackageCodes: ['069', '070', '072', '073', '078', '079'],
  },
  {
    key: 'change-orders',
    title: 'Change order management',
    summary:
      'Run a change order from request through pricing, approval, execution and closeout with customer approval and schedule impact recorded.',
    routes: [
      '/enterprise/projects/{projectId}/change-orders',
      '/enterprise/change-orders/queue',
      '/enterprise/change-orders/{id}',
      '/portal/homeowner/change-orders/{id}',
      '/portal/contractor/change-orders/{id}',
    ],
    kpis: [
      'average approval cycle',
      'change-order value by project',
      'unpriced change aging',
      'approved vs declined ratio',
      'schedule days added',
      'change-order margin',
    ],
    entities: [
      'change_orders',
      'change_order_revisions',
      'change_order_lines',
      'change_order_approvals',
      'change_order_comments',
      'change_order_attachments',
      'change_order_impacts',
    ],
    workPackageCodes: ['048', '039', '041'],
  },
  {
    key: 'communications',
    title: 'Client communication, job mailbox and homeowner portal',
    summary:
      'Keep one auditable conversation across builder, vendor, contractor and homeowner roles with portal updates and questionnaires.',
    routes: [
      '/enterprise/projects/{id}/mailbox',
      '/enterprise/communications/inbox',
      '/enterprise/communications/templates',
      '/portal/homeowner',
      '/portal/homeowner/projects/{id}/updates',
    ],
    kpis: [
      'first response time',
      'unanswered conversations',
      'delivery success',
      'homeowner portal engagement',
      'overdue questionnaire count',
      'escalation SLA',
    ],
    entities: [
      'conversations',
      'conversation_participants',
      'messages',
      'message_attachments',
      'message_delivery_attempts',
      'portal_updates',
      'questionnaires',
    ],
    workPackageCodes: ['024', '059', '062'],
  },
  {
    key: 'documents',
    title: 'Documentation, document control and reporting',
    summary:
      'Make every document revision permission-controlled, approval-tracked and usable in operational reporting.',
    routes: [
      '/enterprise/documents',
      '/enterprise/reports',
      '/enterprise/reports/builder',
      '/enterprise/projects/{id}/documents',
      '/enterprise/audit',
    ],
    kpis: [
      'document retrieval time',
      'approval turnaround',
      'stale revision usage',
      'report generation duration',
      'failed scheduled reports',
      'external share expirations',
    ],
    entities: [
      'documents',
      'document_revisions',
      'document_links',
      'document_permissions',
      'document_share_grants',
      'document_approvals',
      'report_definitions',
    ],
    workPackageCodes: ['083', '080', '099'],
  },
  {
    key: 'estimating',
    title: 'Estimating, assemblies, job templates and client questionnaires',
    summary:
      'Turn verified scope and assemblies into versioned estimates that flow into budgets, schedules, contracts and purchasing.',
    routes: [
      '/enterprise/estimating',
      '/enterprise/estimating/templates',
      '/enterprise/estimating/catalog',
      '/enterprise/projects/{id}/estimate',
      '/portal/homeowner/questionnaires',
    ],
    kpis: [
      'estimate turnaround',
      'estimate-to-contract conversion',
      'gross margin variance',
      'takeoff import correction rate',
      'template reuse',
      'questionnaire completion',
    ],
    entities: [
      'estimates',
      'estimate_revisions',
      'estimate_sections',
      'estimate_lines',
      'assemblies',
      'assembly_revisions',
      'catalog_items',
      'labor_rates',
    ],
    workPackageCodes: ['051', '052', '023', '147'],
  },
  {
    key: 'takeoff',
    title: 'Onscreen takeoff and plan measurement workspace',
    summary:
      'Calibrate plan sheets, measure quantities with revisions and transfer verified quantities into estimate lines.',
    routes: [
      '/enterprise/takeoff',
      '/enterprise/projects/{id}/takeoff',
      '/enterprise/takeoff/{id}/sheets/{sheetId}',
    ],
    kpis: [
      'measurement time per sheet',
      'calibration correction rate',
      'quantity transfer error rate',
      'plan processing duration',
      'approved takeoff revision count',
    ],
    entities: [
      'plan_sets',
      'plan_sheets',
      'plan_revisions',
      'takeoff_calibrations',
      'takeoff_measurements',
      'takeoff_vertices',
      'takeoff_annotations',
    ],
    workPackageCodes: ['052', '018', '148'],
  },
  {
    key: 'jobsite-media',
    title: 'Photo and video jobsite documentation',
    summary:
      'Capture, upload, review and link jobsite media so evidence and completion can be verified.',
    routes: [
      '/enterprise/projects/{id}/media',
      '/enterprise/media/review',
      '/portal/contractor/jobs/{id}/media',
      '/portal/homeowner/projects/{id}/gallery',
    ],
    kpis: [
      'upload completion rate',
      'media per job phase',
      'review turnaround',
      'failed upload retry count',
      'storage use by tenant',
      'evidence linked to completed tasks',
    ],
    entities: [
      'media_assets',
      'media_derivatives',
      'media_links',
      'media_annotations',
      'media_review_events',
      'media_share_grants',
      'upload_sessions',
    ],
    workPackageCodes: ['060', '090', '109'],
  },
  {
    key: 'project-financials',
    title: 'Project financial management, job costing and forecasting',
    summary:
      'Track budget, commitment, actual, forecast, cost-to-complete, profit and WIP at project and company level.',
    routes: [
      '/enterprise/finance/projects',
      '/enterprise/projects/{id}/financials',
      '/enterprise/finance/wip',
      '/enterprise/finance/scenarios',
      '/enterprise/finance/compliance',
    ],
    kpis: [
      'budget variance',
      'forecast margin',
      'commitment coverage',
      'unapproved overrun exposure',
      'WIP age',
      'forecast accuracy',
    ],
    entities: [
      'project_budgets',
      'budget_revisions',
      'budget_lines',
      'cost_codes',
      'cost_commitments',
      'cost_actuals',
      'cost_accruals',
      'forecast_snapshots',
    ],
    workPackageCodes: ['071', '074', '080', '153'],
  },
  {
    key: 'sales',
    title: 'Sales management, lead-to-contract and buyer financial transparency',
    summary:
      'Carry a lead through qualification, appointment, estimate, options, contract, deposit and project handoff.',
    routes: [
      '/enterprise/sales/pipeline',
      '/enterprise/sales/leads',
      '/enterprise/sales/opportunities/{id}',
      '/enterprise/sales/contracts',
      '/portal/homeowner/sales',
    ],
    kpis: [
      'lead response time',
      'stage conversion',
      'bid-to-contract conversion',
      'sales cycle days',
      'forecast accuracy',
      'lead source ROI',
    ],
    entities: [
      'leads',
      'contacts',
      'lead_sources',
      'opportunities',
      'pipeline_stages',
      'sales_activities',
      'proposals',
      'contracts',
      'marketing_consents',
    ],
    workPackageCodes: ['007', '009', '014', '015', '016'],
  },
  {
    key: 'scheduling',
    title: 'Construction scheduling, templates, dependencies and resource planning',
    summary:
      'Plan and track planned versus actual dates and respond to delays with dependencies, resources and critical path.',
    routes: [
      '/enterprise/scheduling',
      '/enterprise/scheduling/templates',
      '/enterprise/projects/{id}/schedule',
      '/portal/contractor/schedule',
      '/portal/supplier/deliveries',
    ],
    kpis: [
      'on-time task rate',
      'schedule variance',
      'critical-path slippage',
      'trade utilization',
      'blocked task age',
      'planned vs actual duration',
    ],
    entities: [
      'schedule_templates',
      'schedule_revisions',
      'schedule_tasks',
      'task_dependencies',
      'task_assignments',
      'resource_calendars',
      'crew_allocations',
      'task_actuals',
    ],
    workPackageCodes: ['032', '033', '034', '152'],
  },
  {
    key: 'team-collaboration',
    title: 'Team collaboration, task accountability, job mailbox and job journal',
    summary:
      'Keep tasks, checklists, comments, evidence and project-linked conversations accountable across office and field.',
    routes: [
      '/enterprise/tasks',
      '/enterprise/tasks/my-work',
      '/enterprise/projects/{id}/team',
      '/enterprise/projects/{id}/journal',
      '/enterprise/projects/{id}/mailbox',
    ],
    kpis: [
      'task completion rate',
      'overdue task count',
      'average task age',
      'blocked task duration',
      'message response time',
      'journal entries per active job',
    ],
    entities: [
      'tasks',
      'task_checklist_items',
      'task_watchers',
      'task_comments',
      'job_journal_entries',
      'job_mailbox_threads',
      'task_evidence',
    ],
    workPackageCodes: ['035', '010', '103'],
  },
  {
    key: 'vendor-bidding',
    title: 'Vendor bidding, RFQs, bid comparison and award',
    summary:
      'Issue RFQs, normalize bids, compare like-for-like and turn approved work into a purchase commitment.',
    routes: [
      '/enterprise/bids',
      '/enterprise/projects/{id}/bid-packages',
      '/enterprise/bids/{id}/compare',
      '/portal/contractor/bids',
      '/portal/supplier/rfqs',
    ],
    kpis: [
      'vendor response rate',
      'RFQ cycle time',
      'bid spread',
      'award savings vs estimate',
      'unresponsive bid count',
      'award-to-PO duration',
    ],
    entities: [
      'bid_packages',
      'bid_package_lines',
      'bid_invitations',
      'bid_responses',
      'bid_response_revisions',
      'bid_line_prices',
      'bid_clarifications',
      'bid_comparisons',
      'bid_awards',
    ],
    workPackageCodes: ['043', '044', '045', '046'],
  },
  {
    key: 'vendor-management',
    title: 'Vendor and subcontractor management, qualification and performance',
    summary:
      'Maintain vendor identity, compliance evidence, onboarding status and project performance with expiry control.',
    routes: [
      '/enterprise/vendors',
      '/enterprise/vendors/onboarding',
      '/enterprise/vendors/{id}',
      '/enterprise/compliance/expirations',
      '/portal/vendor/profile',
    ],
    kpis: [
      'qualification turnaround',
      'compliance expiry exposure',
      'vendor response rate',
      'on-time completion',
      'rework rate',
      'vendor concentration risk',
    ],
    entities: [
      'vendors',
      'vendor_contacts',
      'vendor_trades',
      'vendor_regions',
      'vendor_licenses',
      'vendor_insurance_policies',
      'vendor_qualifications',
      'vendor_performance',
    ],
    workPackageCodes: ['042', '055', '058', '151'],
  },
];

export function findControlModule(key: string): EnterpriseControlModule | undefined {
  return ENTERPRISE_CONTROL_MODULES.find((module) => module.key === key);
}
