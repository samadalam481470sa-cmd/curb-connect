// PLT-011 centralized route registry: paths, labels, breadcrumbs, required permission, feature
// flag and analytics event name. Navigation reflects permissions and entitlements, but the API
// stays authoritative. Roof Measurements and Curb Cutting are equal peers (PLT-011 A).
import { BRAND } from './brand';
import type { FeatureFlagKey } from './flags';
import type { Action } from './rbac';

export type NavPlacement = 'primary' | 'secondary' | 'hidden';

export interface RouteDefinition {
  id: string;
  path: string;
  label: string;
  /** Permission needed to see and open the route. */
  permission: Action;
  /** Optional feature flag; when off the route shows as unavailable, never as fake data. */
  featureFlag?: FeatureFlagKey;
  /** Fired once when the route is viewed (snake_case, `<area>_viewed`). */
  analyticsEvent: string;
  /** Parent route id for breadcrumbs. */
  parent?: string;
  nav: NavPlacement;
  /** Order in the sidebar / bottom navigation. */
  navOrder?: number;
  /**
   * Navigation section id (see NAV_SECTIONS) for the collapsible menu tree. Routes without a
   * section render at the top level, directly under Home (PLT-011 A keeps Roof Measurements and
   * Curb Cutting there as adjacent peers).
   */
  section?: NavSectionId;
  /** Optional subsection id within the section (see NAV_SECTIONS). */
  subsection?: string;
  /** Shown in the phone bottom bar (at most five). */
  mobileBottomNav?: boolean;
  /** Short icon name for packages/ui (generic names, not brand assets). */
  icon?: string;
  requirementIds: readonly string[];
}

export type NavSectionId =
  | 'operations'
  | 'sales'
  | 'build'
  | 'finance'
  | 'land'
  | 'service'
  | 'company';

export interface NavSectionDefinition {
  id: NavSectionId;
  label: string;
  /** Subsections in display order; routes without one sit directly under the section header. */
  subsections: readonly { id: string; label: string }[];
}

/**
 * The collapsible navigation sections, in display order. Unsectioned routes (Home, Roof
 * Measurements, Curb Cutting) always render first at the top level.
 */
export const NAV_SECTIONS: readonly NavSectionDefinition[] = [
  {
    id: 'operations',
    label: 'Operations',
    subsections: [
      { id: 'work-flow', label: 'Work flow' },
      { id: 'scheduling', label: 'Scheduling' },
      { id: 'orders-bids', label: 'Orders & bids' },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    subsections: [
      { id: 'pipeline', label: 'Pipeline' },
      { id: 'selling', label: 'Selling' },
    ],
  },
  {
    id: 'build',
    label: 'Build & Estimate',
    subsections: [
      { id: 'estimators', label: 'Estimators' },
      { id: 'trades', label: 'Trades' },
    ],
  },
  {
    id: 'finance',
    label: 'Finance',
    subsections: [
      { id: 'money-in', label: 'Money in' },
      { id: 'money-out', label: 'Money out' },
      { id: 'reporting', label: 'Reporting' },
    ],
  },
  { id: 'land', label: 'Land', subsections: [] },
  {
    id: 'service',
    label: 'Service & Field',
    subsections: [
      { id: 'field', label: 'Field' },
      { id: 'homeowner-care', label: 'Homeowner care' },
    ],
  },
  {
    id: 'company',
    label: 'Company',
    subsections: [
      { id: 'people', label: 'People' },
      { id: 'setup', label: 'Setup' },
    ],
  },
];

/** The ten primary areas from page 011, in navigation order. */
export const PRIMARY_ROUTES = [
  {
    id: 'home',
    path: '/',
    label: 'Home',
    permission: 'dashboard:read',
    analyticsEvent: 'home_viewed',
    nav: 'primary',
    navOrder: 10,
    mobileBottomNav: true,
    icon: 'home',
    requirementIds: ['PLT-011', 'PLT-016'],
  },
  {
    id: 'roof',
    path: '/roof',
    label: BRAND.products.roof,
    permission: 'roof_order:read',
    featureFlag: 'roof.orders',
    analyticsEvent: 'roof_measurements_viewed',
    nav: 'primary',
    navOrder: 20,
    mobileBottomNav: true,
    icon: 'roof',
    requirementIds: ['PLT-011', 'RF-021'],
  },
  {
    id: 'curb',
    path: '/curb',
    label: BRAND.products.curb,
    permission: 'curb_project:read',
    featureFlag: 'curb.projects',
    analyticsEvent: 'curb_cutting_viewed',
    nav: 'primary',
    navOrder: 30,
    mobileBottomNav: true,
    icon: 'curb',
    requirementIds: ['PLT-011', 'CV-042'],
  },
  {
    id: 'build',
    path: '/build',
    label: 'House Builder',
    permission: 'estimate:read',
    analyticsEvent: 'house_builder_viewed',
    nav: 'primary',
    navOrder: 33,
    section: 'build',
    subsection: 'estimators',
    icon: 'build',
    requirementIds: ['HB-001', 'HB-002'],
  },
  {
    id: 'plumbing',
    path: '/plumbing',
    label: 'Plumbing',
    permission: 'plumbing:read',
    analyticsEvent: 'plumbing_viewed',
    nav: 'primary',
    navOrder: 35,
    section: 'build',
    subsection: 'trades',
    icon: 'document',
    requirementIds: ['PL-001', 'PL-016'],
  },
  {
    id: 'lawn',
    path: '/lawn',
    label: 'Lawn Care',
    permission: 'estimate:read',
    analyticsEvent: 'lawn_care_viewed',
    nav: 'primary',
    navOrder: 37,
    section: 'build',
    subsection: 'trades',
    icon: 'lawn',
    requirementIds: ['LAWN-001', 'LAWN-002'],
  },
  {
    id: 'hvac',
    path: '/hvac',
    label: 'HVAC',
    permission: 'estimate:read',
    analyticsEvent: 'hvac_viewed',
    nav: 'primary',
    navOrder: 38,
    section: 'build',
    subsection: 'trades',
    icon: 'document',
    requirementIds: ['HVAC-001'],
  },
  {
    id: 'electrical',
    path: '/electrical',
    label: 'Electrical',
    permission: 'estimate:read',
    analyticsEvent: 'electrical_viewed',
    nav: 'primary',
    navOrder: 39,
    section: 'build',
    subsection: 'trades',
    icon: 'document',
    requirementIds: ['ELEC-001'],
  },
  {
    id: 'supplierOrders',
    path: '/supplier-orders',
    label: 'Supplier Orders',
    permission: 'supplier_order:read',
    featureFlag: 'ops.supplier_orders',
    analyticsEvent: 'supplier_orders_viewed',
    nav: 'hidden',
    navOrder: 95,
    section: 'operations',
    subsection: 'orders-bids',
    icon: 'document',
    requirementIds: ['OPS-066'],
  },
  {
    id: 'crewBoard',
    path: '/crew-board',
    label: 'Crew Board',
    permission: 'schedule:read',
    analyticsEvent: 'crew_board_viewed',
    nav: 'primary',
    navOrder: 44,
    section: 'operations',
    subsection: 'scheduling',
    icon: 'board',
    requirementIds: ['OPS-061'],
  },
  {
    id: 'projectManagement',
    path: '/project-management',
    label: 'Project Management',
    permission: 'job:read',
    analyticsEvent: 'project_management_viewed',
    nav: 'primary',
    navOrder: 45,
    section: 'operations',
    subsection: 'scheduling',
    icon: 'board',
    requirementIds: ['OPS-061'],
  },
  {
    id: 'landScout',
    path: '/land-scout',
    label: 'Land Scout',
    permission: 'land_scout:read',
    analyticsEvent: 'land_scout_viewed',
    nav: 'primary',
    navOrder: 46,
    section: 'land',
    icon: 'document',
    requirementIds: ['LAND-001'],
  },
  {
    id: 'gisWorkbench',
    path: '/gis-workbench',
    label: 'GIS Workbench',
    permission: 'estimate:read',
    analyticsEvent: 'gis_workbench_viewed',
    nav: 'primary',
    navOrder: 46,
    section: 'land',
    icon: 'map',
    requirementIds: ['GIS-001'],
  },
  {
    id: 'planToBid',
    path: '/plan-to-bid',
    label: 'Plan to Bid',
    permission: 'estimate:read',
    analyticsEvent: 'plan_to_bid_viewed',
    nav: 'primary',
    navOrder: 47,
    section: 'build',
    subsection: 'estimators',
    icon: 'document',
    requirementIds: ['EST-001'],
  },
  {
    id: 'govOpportunities',
    path: '/gov-opportunities',
    label: 'Gov Opportunities',
    permission: 'job:read',
    analyticsEvent: 'gov_opportunities_viewed',
    nav: 'primary',
    navOrder: 48,
    section: 'sales',
    subsection: 'selling',
    icon: 'document',
    requirementIds: ['GOV-001'],
  },
  {
    id: 'leads',
    path: '/leads',
    label: 'Leads',
    permission: 'lead:read',
    featureFlag: 'crm.leads',
    analyticsEvent: 'leads_viewed',
    nav: 'primary',
    navOrder: 40,
    section: 'sales',
    subsection: 'pipeline',
    icon: 'inbox',
    requirementIds: ['PLT-011', 'OPS-061'],
  },
  {
    id: 'customers',
    path: '/customers',
    label: 'Customers',
    permission: 'customer:read',
    analyticsEvent: 'customers_viewed',
    nav: 'primary',
    navOrder: 49,
    section: 'sales',
    subsection: 'pipeline',
    icon: 'people',
    requirementIds: ['OPS-061'],
  },
  {
    id: 'jobs',
    path: '/jobs',
    label: 'Jobs',
    permission: 'job:read',
    featureFlag: 'crm.jobs',
    analyticsEvent: 'jobs_viewed',
    nav: 'primary',
    navOrder: 50,
    section: 'operations',
    subsection: 'work-flow',
    mobileBottomNav: true,
    icon: 'board',
    requirementIds: ['PLT-011', 'OPS-062'],
  },
  {
    id: 'bidding',
    path: '/bidding',
    label: 'Bidding',
    permission: 'job:read',
    analyticsEvent: 'bidding_viewed',
    nav: 'primary',
    navOrder: 55,
    section: 'operations',
    subsection: 'orders-bids',
    icon: 'board',
    requirementIds: ['OPS-062', 'COS-06'],
  },
  {
    id: 'manualOrders',
    path: '/manual-orders',
    label: 'Manual Orders',
    permission: 'supplier_order:read',
    analyticsEvent: 'manual_orders_viewed',
    nav: 'primary',
    navOrder: 56,
    section: 'operations',
    subsection: 'orders-bids',
    icon: 'document',
    requirementIds: ['OPS-066'],
  },
  {
    id: 'permitJobs',
    path: '/permit-jobs',
    label: 'Permit Job Search',
    permission: 'job:read',
    analyticsEvent: 'permit_jobs_viewed',
    nav: 'primary',
    navOrder: 57,
    section: 'operations',
    subsection: 'work-flow',
    icon: 'board',
    requirementIds: ['OPS-062', 'COS-06'],
  },
  {
    id: 'field',
    path: '/field',
    label: 'Field',
    permission: 'job:read',
    analyticsEvent: 'field_viewed',
    nav: 'primary',
    navOrder: 57,
    section: 'service',
    subsection: 'field',
    icon: 'clock',
    requirementIds: ['OPS-076'],
  },
  {
    id: 'proposals',
    path: '/proposals',
    label: 'Proposals',
    permission: 'proposal:read',
    featureFlag: 'proposals',
    analyticsEvent: 'proposals_viewed',
    nav: 'primary',
    navOrder: 60,
    section: 'sales',
    subsection: 'selling',
    icon: 'document',
    requirementIds: ['PLT-011', 'OPS-063'],
  },
  {
    id: 'estimateTemplates',
    path: '/estimate-templates',
    label: 'Estimate Templates',
    permission: 'estimate:read',
    analyticsEvent: 'estimate_templates_viewed',
    nav: 'primary',
    navOrder: 61,
    section: 'sales',
    subsection: 'selling',
    icon: 'document',
    requirementIds: ['OPS-063'],
  },
  {
    id: 'network',
    path: '/network',
    label: 'Network',
    permission: 'network:read',
    analyticsEvent: 'network_viewed',
    nav: 'primary',
    navOrder: 65,
    section: 'company',
    subsection: 'people',
    icon: 'people',
    requirementIds: ['COS-06', 'COS-07'],
  },
  {
    id: 'billing',
    path: '/billing',
    label: 'Billing',
    permission: 'invoice:read',
    featureFlag: 'billing.invoices',
    analyticsEvent: 'billing_viewed',
    nav: 'primary',
    navOrder: 70,
    section: 'finance',
    subsection: 'money-in',
    icon: 'receipt',
    requirementIds: ['PLT-011', 'OPS-068'],
  },
  {
    id: 'analysis',
    path: '/analysis',
    label: 'Analysis',
    permission: 'invoice:read',
    featureFlag: 'billing.invoices',
    analyticsEvent: 'analysis_viewed',
    nav: 'primary',
    navOrder: 72,
    section: 'finance',
    subsection: 'money-in',
    icon: 'chart',
    requirementIds: ['PLT-011', 'OPS-068'],
  },
  {
    id: 'reports',
    path: '/reports',
    label: 'Reports',
    permission: 'analytics:read',
    analyticsEvent: 'reports_viewed',
    nav: 'primary',
    navOrder: 80,
    section: 'finance',
    subsection: 'reporting',
    icon: 'chart',
    requirementIds: ['PLT-011', 'AIQ-088'],
  },
  {
    id: 'team',
    path: '/team',
    label: 'Team',
    permission: 'team:read',
    analyticsEvent: 'team_viewed',
    nav: 'primary',
    navOrder: 90,
    section: 'company',
    subsection: 'people',
    icon: 'people',
    requirementIds: ['PLT-011', 'PLT-015'],
  },
  {
    id: 'settings',
    path: '/settings',
    label: 'Settings',
    permission: 'org:read',
    analyticsEvent: 'settings_viewed',
    nav: 'primary',
    navOrder: 100,
    section: 'company',
    subsection: 'setup',
    mobileBottomNav: true,
    icon: 'settings',
    requirementIds: ['PLT-011', 'PLT-014'],
  },
  // Builder operations (Hyphen-equivalent section): warranty/service, job cost + payables,
  // home sales + design center, supplier order flow, land management, attention feed,
  // field time + checklists, integrations. Additive; nothing above changes.
  {
    id: 'attention',
    path: '/attention',
    label: 'Attention Feed',
    permission: 'attention:read',
    analyticsEvent: 'attention_feed_viewed',
    nav: 'primary',
    navOrder: 31,
    section: 'service',
    subsection: 'homeowner-care',
    icon: 'bell',
    requirementIds: ['OPS-070'],
  },
  {
    id: 'warranty',
    path: '/warranty',
    label: 'Warranty & Service',
    permission: 'warranty:read',
    analyticsEvent: 'warranty_viewed',
    nav: 'primary',
    navOrder: 51,
    section: 'service',
    subsection: 'homeowner-care',
    icon: 'shield',
    requirementIds: ['OPS-071'],
  },
  {
    id: 'homeSales',
    path: '/home-sales',
    label: 'Home Sales',
    permission: 'sales:read',
    analyticsEvent: 'home_sales_viewed',
    nav: 'primary',
    navOrder: 52,
    section: 'sales',
    subsection: 'pipeline',
    icon: 'people',
    requirementIds: ['OPS-072'],
  },
  {
    id: 'designCenter',
    path: '/design-center',
    label: 'Design Center',
    permission: 'design_center:read',
    analyticsEvent: 'design_center_viewed',
    nav: 'primary',
    navOrder: 53,
    section: 'sales',
    subsection: 'selling',
    icon: 'build',
    requirementIds: ['OPS-073'],
  },
  {
    id: 'landManagement',
    path: '/land-management',
    label: 'Land Management',
    permission: 'land_management:read',
    analyticsEvent: 'land_management_viewed',
    nav: 'primary',
    navOrder: 54,
    section: 'land',
    icon: 'map',
    requirementIds: ['LAND-002'],
  },
  {
    id: 'networkOrders',
    path: '/network-orders',
    label: 'Network Orders',
    permission: 'network_order:read',
    analyticsEvent: 'network_orders_viewed',
    nav: 'primary',
    navOrder: 66,
    section: 'operations',
    subsection: 'orders-bids',
    icon: 'truck',
    requirementIds: ['COS-11'],
  },
  {
    id: 'jobCost',
    path: '/job-cost',
    label: 'Job Cost',
    permission: 'job_cost:read',
    analyticsEvent: 'job_cost_viewed',
    nav: 'primary',
    navOrder: 73,
    section: 'finance',
    subsection: 'money-out',
    icon: 'chart',
    requirementIds: ['OPS-074'],
  },
  {
    id: 'payables',
    path: '/payables',
    label: 'Payables',
    permission: 'ap:read',
    analyticsEvent: 'payables_viewed',
    nav: 'primary',
    navOrder: 74,
    section: 'finance',
    subsection: 'money-out',
    icon: 'receipt',
    requirementIds: ['OPS-075'],
  },
  {
    id: 'timeTracking',
    path: '/time-tracking',
    label: 'Time Tracking',
    permission: 'time_entry:read',
    analyticsEvent: 'time_tracking_viewed',
    nav: 'primary',
    navOrder: 58,
    section: 'service',
    subsection: 'field',
    icon: 'clock',
    requirementIds: ['OPS-076'],
  },
  {
    id: 'fieldInspections',
    path: '/field-inspections',
    label: 'Field Inspections',
    permission: 'inspection_checklist:read',
    analyticsEvent: 'field_inspections_viewed',
    nav: 'primary',
    navOrder: 59,
    section: 'service',
    subsection: 'field',
    icon: 'document',
    requirementIds: ['OPS-077'],
  },
  {
    id: 'integrations',
    path: '/integrations',
    label: 'Integrations',
    permission: 'integration:manage',
    analyticsEvent: 'integrations_viewed',
    nav: 'primary',
    navOrder: 101,
    section: 'company',
    subsection: 'setup',
    icon: 'settings',
    requirementIds: ['OPS-078'],
  },
  {
    id: 'assignments',
    path: '/assignments',
    label: 'Assignments',
    permission: 'assignment:read',
    analyticsEvent: 'assignments_viewed',
    nav: 'primary',
    navOrder: 67,
    section: 'operations',
    subsection: 'work-flow',
    icon: 'inbox',
    requirementIds: ['COS-12'],
  },
] as const satisfies readonly RouteDefinition[];

/** Deep-linkable detail and flow routes. `:param` segments are filled by routePath(). */
export const DETAIL_ROUTES = [
  {
    id: 'roof.agents',
    path: '/roof/agents',
    label: 'AI Agents',
    permission: 'roof_order:read',
    featureFlag: 'roof.orders',
    analyticsEvent: 'roof_agents_viewed',
    parent: 'roof',
    nav: 'secondary',
    icon: 'roof',
    requirementIds: ['RF-021'],
  },
  {
    id: 'roof.new',
    path: '/roof/new',
    label: 'New roof order',
    permission: 'roof_order:create',
    featureFlag: 'roof.orders',
    analyticsEvent: 'roof_order_create_viewed',
    parent: 'roof',
    nav: 'hidden',
    requirementIds: ['RF-021', 'PLT-017'],
  },
  {
    id: 'roof.order',
    path: '/roof/orders/:orderId',
    label: 'Roof order',
    permission: 'roof_order:read',
    analyticsEvent: 'roof_order_viewed',
    parent: 'roof',
    nav: 'hidden',
    requirementIds: ['RF-021', 'RR-039'],
  },
  {
    id: 'roof.report',
    path: '/roof/reports/:reportId',
    label: 'Roof report',
    permission: 'roof_report:read',
    analyticsEvent: 'roof_report_viewed',
    parent: 'roof',
    nav: 'hidden',
    requirementIds: ['RF-025', 'RR-036', 'RR-037'],
  },
  {
    id: 'roof.report.editor',
    path: '/roof/reports/:reportId/edit',
    label: 'Roof sketch',
    permission: 'roof_report:edit_geometry',
    featureFlag: 'roof.diy_canvas',
    analyticsEvent: 'roof_editor_viewed',
    parent: 'roof.report',
    nav: 'hidden',
    requirementIds: ['RF-023', 'RR-032'],
  },
  {
    id: 'roof.review_queue',
    path: '/roof/review',
    label: 'Measurement review',
    permission: 'review_task:read',
    featureFlag: 'roof.assisted_review',
    analyticsEvent: 'roof_review_queue_viewed',
    parent: 'roof',
    nav: 'secondary',
    requirementIds: ['RR-033', 'AIQ-086'],
  },
  {
    id: 'roof.inspection',
    path: '/roof/inspection',
    label: 'Photo inspection report',
    permission: 'roof_order:read',
    featureFlag: 'roof.orders',
    analyticsEvent: 'roof_inspection_viewed',
    parent: 'roof',
    nav: 'hidden',
    requirementIds: ['RF-021'],
  },
  {
    id: 'curb.new',
    path: '/curb/new',
    label: 'New curb project',
    permission: 'curb_project:write',
    featureFlag: 'curb.projects',
    analyticsEvent: 'curb_project_create_viewed',
    parent: 'curb',
    nav: 'hidden',
    requirementIds: ['CV-042'],
  },
  {
    id: 'curb.project',
    path: '/curb/projects/:projectId',
    label: 'Curb project',
    permission: 'curb_project:read',
    analyticsEvent: 'curb_project_viewed',
    parent: 'curb',
    nav: 'hidden',
    requirementIds: ['CV-042', 'CV-050'],
  },
  {
    id: 'curb.capture',
    path: '/curb/projects/:projectId/capture',
    label: 'Photo capture',
    permission: 'curb_media:upload',
    featureFlag: 'curb.guided_capture',
    analyticsEvent: 'curb_capture_viewed',
    parent: 'curb.project',
    nav: 'hidden',
    requirementIds: ['CV-043', 'PLT-018'],
  },
  {
    id: 'curb.estimate',
    path: '/curb/projects/:projectId/estimates/:estimateId',
    label: 'Curb estimate',
    permission: 'estimate:read',
    analyticsEvent: 'curb_estimate_viewed',
    parent: 'curb.project',
    nav: 'hidden',
    requirementIds: ['CP-052', 'CP-058', 'CP-059'],
  },
  {
    id: 'leads.detail',
    path: '/leads/:leadId',
    label: 'Lead',
    permission: 'lead:read',
    analyticsEvent: 'lead_viewed',
    parent: 'leads',
    nav: 'hidden',
    requirementIds: ['OPS-061'],
  },
  {
    id: 'customers.detail',
    path: '/customers/:customerId',
    label: 'Customer',
    permission: 'customer:read',
    analyticsEvent: 'customer_viewed',
    parent: 'leads',
    nav: 'hidden',
    requirementIds: ['OPS-061'],
  },
  {
    id: 'jobs.detail',
    path: '/jobs/:jobId',
    label: 'Job',
    permission: 'job:read',
    analyticsEvent: 'job_viewed',
    parent: 'jobs',
    nav: 'hidden',
    requirementIds: ['OPS-062', 'OPS-067'],
  },
  {
    id: 'proposals.detail',
    path: '/proposals/:proposalId',
    label: 'Proposal',
    permission: 'proposal:read',
    analyticsEvent: 'proposal_viewed',
    parent: 'proposals',
    nav: 'hidden',
    requirementIds: ['OPS-063', 'OPS-064'],
  },
  {
    id: 'billing.invoice',
    path: '/billing/invoices/:invoiceId',
    label: 'Invoice',
    permission: 'invoice:read',
    analyticsEvent: 'invoice_viewed',
    parent: 'billing',
    nav: 'hidden',
    requirementIds: ['OPS-068'],
  },
  {
    id: 'billing.imports',
    path: '/billing/imports',
    label: 'Invoice import',
    permission: 'invoice:read',
    featureFlag: 'billing.invoices',
    analyticsEvent: 'invoice_imports_viewed',
    parent: 'billing',
    nav: 'hidden',
    requirementIds: ['OPS-068'],
  },
  {
    id: 'billing.bills',
    path: '/billing/bills',
    label: 'Bills received',
    permission: 'bill:read',
    analyticsEvent: 'bills_received_viewed',
    parent: 'billing',
    nav: 'secondary',
    requirementIds: ['COS-08'],
  },
  {
    id: 'network.projects',
    path: '/network/projects',
    label: 'Shared projects',
    permission: 'network:read',
    analyticsEvent: 'network_projects_viewed',
    parent: 'network',
    nav: 'secondary',
    requirementIds: ['COS-06', 'COS-10'],
  },
  {
    id: 'settings.price_books',
    path: '/settings/price-books',
    label: 'Price books',
    permission: 'price_book:read',
    analyticsEvent: 'price_books_viewed',
    parent: 'settings',
    nav: 'secondary',
    requirementIds: ['CP-057', 'OPS-065'],
  },
  {
    id: 'settings.connectors',
    path: '/settings/connectors',
    label: 'Bidding integrations',
    permission: 'integration:manage',
    analyticsEvent: 'settings_connectors_viewed',
    parent: 'settings',
    nav: 'secondary',
    icon: 'settings',
    requirementIds: ['COS-06', 'OPS-062'],
  },
  {
    id: 'settings.email',
    path: '/settings/email',
    label: 'Email sending',
    permission: 'mailbox:manage_own',
    analyticsEvent: 'settings_email_viewed',
    parent: 'settings',
    nav: 'secondary',
    icon: 'settings',
    requirementIds: ['OPS-068', 'PLT-020'],
  },
  {
    id: 'settings.notifications',
    path: '/settings/notifications',
    label: 'Notifications',
    permission: 'notification:update_preferences',
    analyticsEvent: 'notification_settings_viewed',
    parent: 'settings',
    nav: 'secondary',
    requirementIds: ['PLT-020'],
  },
  {
    id: 'enterprise.blueprint',
    path: '/enterprise/blueprint',
    label: 'Enterprise Blueprint',
    permission: 'org:read',
    analyticsEvent: 'enterprise_blueprint_viewed',
    nav: 'secondary',
    navOrder: 10,
    icon: 'build',
    requirementIds: ['PLT-011'],
  },
  {
    id: 'enterprise.scheduling',
    path: '/enterprise/scheduling',
    label: 'Enterprise Scheduling',
    permission: 'job:read',
    analyticsEvent: 'enterprise_scheduling_viewed',
    nav: 'hidden',
    requirementIds: ['PLT-011'],
  },
  {
    id: 'enterprise.bidding',
    path: '/enterprise/bids',
    label: 'Enterprise Vendor Bidding',
    permission: 'job:read',
    analyticsEvent: 'enterprise_bidding_viewed',
    nav: 'hidden',
    requirementIds: ['PLT-011'],
  },
  {
    id: 'enterprise.estimating',
    path: '/enterprise/estimating',
    label: 'Enterprise Estimating',
    permission: 'estimate:read',
    analyticsEvent: 'enterprise_estimating_viewed',
    nav: 'hidden',
    requirementIds: ['PLT-011'],
  },
  {
    id: 'enterprise.salesLeads',
    path: '/enterprise/sales/leads',
    label: 'Sales leads',
    permission: 'enterprise_sales:intake',
    analyticsEvent: 'enterprise_sales_leads_viewed',
    nav: 'hidden',
    requirementIds: ['PLT-011'],
  },
  {
    id: 'enterprise.changeOrders',
    path: '/enterprise/change-orders/queue',
    label: 'Change Orders',
    permission: 'job:read',
    analyticsEvent: 'enterprise_change_orders_viewed',
    nav: 'hidden',
    requirementIds: ['PLT-011'],
  },
  {
    id: 'onboarding',
    path: '/onboarding',
    label: 'Company setup',
    permission: 'org:update',
    analyticsEvent: 'onboarding_viewed',
    nav: 'hidden',
    requirementIds: ['PLT-014'],
  },
  {
    id: 'search',
    path: '/search',
    label: 'Search',
    permission: 'search:read',
    analyticsEvent: 'search_viewed',
    nav: 'hidden',
    requirementIds: ['PLT-016'],
  },
  {
    id: 'assistant',
    path: '/ask',
    label: 'Ask Field Pro',
    permission: 'search:read',
    analyticsEvent: 'assistant_viewed',
    nav: 'hidden',
    requirementIds: ['PLT-016'],
  },
] as const satisfies readonly RouteDefinition[];

/** Routes outside the signed-in shell (no membership required). */
export const PUBLIC_PATHS = {
  signIn: '/sign-in',
  signUp: '/sign-up',
  forgotPassword: '/forgot-password',
  resetPassword: '/reset-password',
  selectWorkspace: '/select-workspace',
  accessDenied: '/access',
  invitation: '/invite/:token',
  portal: '/portal/:token',
  /** Customer job-status link; the token travels in the fragment (#t=...), never the path. */
  jobStatus: '/track',
} as const;

export const ROUTES: readonly RouteDefinition[] = [...PRIMARY_ROUTES, ...DETAIL_ROUTES];
export type RouteId = (typeof PRIMARY_ROUTES)[number]['id'] | (typeof DETAIL_ROUTES)[number]['id'];

const BY_ID = new Map<string, RouteDefinition>(ROUTES.map((r) => [r.id, r]));

export function getRoute(id: RouteId): RouteDefinition {
  const route = BY_ID.get(id);
  if (!route) throw new Error(`Unknown route id ${id}`);
  return route;
}

/** Fills `:param` segments; throws when a parameter is missing so links never 404 silently. */
export function routePath(id: RouteId, params: Record<string, string> = {}): string {
  return getRoute(id).path.replace(/:([A-Za-z]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined || value === '') throw new Error(`routePath(${id}): missing :${name}`);
    return encodeURIComponent(value);
  });
}

/** Breadcrumb trail from the root to the route (inclusive). */
export function breadcrumbs(id: RouteId): RouteDefinition[] {
  const trail: RouteDefinition[] = [];
  let current: RouteDefinition | undefined = getRoute(id);
  while (current) {
    trail.unshift(current);
    current = current.parent ? BY_ID.get(current.parent) : undefined;
  }
  return trail;
}

export interface NavigationItem {
  route: RouteDefinition;
  /**
   * `unavailable`: the role may use it but the feature flag is off, so the item is shown visibly
   * disabled with an explanation instead of being hidden or faked.
   */
  availability: 'available' | 'unavailable';
}

/**
 * Primary navigation for a member: routes the role cannot open are omitted; routes whose flag is
 * off stay visible as unavailable.
 */
export function visibleNavigation(
  isAllowed: (action: Action) => boolean,
  isFlagEnabled: (flag: FeatureFlagKey) => boolean = () => true,
): NavigationItem[] {
  return (PRIMARY_ROUTES as readonly RouteDefinition[])
    .filter((r) => isAllowed(r.permission))
    .sort((a, b) => (a.navOrder ?? 0) - (b.navOrder ?? 0))
    .map((route) => ({
      route,
      availability:
        !route.featureFlag || isFlagEnabled(route.featureFlag) ? 'available' : 'unavailable',
    }));
}

export interface NavigationTreeGroup {
  id: string;
  label: string;
  items: NavigationItem[];
}

export interface NavigationTreeSection {
  /** Section id, or 'top' for the unsectioned routes rendered without a header. */
  id: string;
  /** Section header label; null for the top-level group (rendered with no header). */
  label: string | null;
  /** Items with no subsection, in navOrder. */
  items: NavigationItem[];
  /** Non-empty subsections, in NAV_SECTIONS order. */
  groups: NavigationTreeGroup[];
}

/**
 * The visible navigation grouped into the collapsible section tree: unsectioned routes first
 * (Home, Roof Measurements, Curb Cutting keep their PLT-011 A positions), then NAV_SECTIONS in
 * order. Sections and subsections with no visible items are dropped, so a role never sees an
 * empty header. Item-level permission and flag rules are exactly visibleNavigation's.
 */
export function navigationTree(
  isAllowed: (action: Action) => boolean,
  isFlagEnabled: (flag: FeatureFlagKey) => boolean = () => true,
): NavigationTreeSection[] {
  const visible = visibleNavigation(isAllowed, isFlagEnabled);
  const sections: NavigationTreeSection[] = [];

  const top = visible.filter((i) => !i.route.section);
  if (top.length > 0) sections.push({ id: 'top', label: null, items: top, groups: [] });

  for (const def of NAV_SECTIONS) {
    const inSection = visible.filter((i) => i.route.section === def.id);
    if (inSection.length === 0) continue;
    const groups: NavigationTreeGroup[] = [];
    for (const sub of def.subsections) {
      const items = inSection.filter((i) => i.route.subsection === sub.id);
      if (items.length > 0) groups.push({ id: sub.id, label: sub.label, items });
    }
    sections.push({
      id: def.id,
      label: def.label,
      items: inSection.filter((i) => !i.route.subsection),
      groups,
    });
  }
  return sections;
}
