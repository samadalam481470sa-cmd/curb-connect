import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import authModule from './auth';
import orgsModule from './orgs';
import teamModule from './team';
import sessionModule from './session';
import flagsModule from './flags';
import auditModule from './audit';
import mediaModule from './media';
import storageModule from './storage';
import imageryModule from './imagery';
import propertiesModule from './properties';
import roofModule from './roof';
import curbModule from './curb';
import pricebooksModule from './pricebooks';
import estimatesModule from './estimates';
import approvalsModule from './approvals';
import crmModule from './crm';
import jobsModule from './jobs';
import supplierOrdersModule from './supplierOrders';
import externalBidsModule from './externalBids';
import permitLeadsModule from './permitLeads';
import invoiceIntelModule from './invoiceIntel';
import outreachModule from './outreach';
import proposalsModule from './proposals';
import signaturesModule from './signatures';
import invoicesModule from './invoices';
import billsModule from './bills';
import networkModule from './network';
import plumbingModule from './plumbing';
import paymentsModule from './payments';
import changeordersModule from './changeorders';
import portalModule from './portal';
import notificationsModule from './notifications';
import dashboardModule from './dashboard';
import searchModule from './search';
import billingModule from './billing';
import exportsModule from './exports';
import reviewsModule from './reviews';
import visionModule from './vision';
import adminModule from './admin';
import enterpriseModule from './enterprise';
import userDraftsModule from './userDrafts';
import homeBuilderModule from './homeBuilder';
import roofDamageModule from './roofDamage';
import mailboxesModule from './mailboxes';
import assistantModule from './assistant';
import projectManagementModule from './projectManagement';
import landScoutModule from './landScout';
import landFeasibilityModule from './landFeasibility';
import planToBidModule from './planToBid';
import govOpportunitiesModule from './govOpportunities';
import roofStormsModule from './roofStorms';
import roofClaimsModule from './roofClaims';
import followUpsModule from './followUps';
import voiceFrontDeskModule from './voiceFrontDesk';
import inspectionsModule from './inspections';
import gisWorkbenchModule from './gisWorkbench';
import warrantyModule from './warranty';
import jobCostModule from './jobCost';
import homeSalesModule from './homeSales';
import supplierFlowModule from './supplierFlow';
import landManagementModule from './landManagement';
import attentionModule from './attention';
import fieldOpsModule from './fieldOps';
import assignmentsModule from './assignments';
import integrationsModule from './integrations';

export interface ApiModule {
  /** Stable module name; also the folder under src/modules and src/db/schema. */
  name: string;
  summary: string;
  plugin: FastifyPluginAsyncZod;
}

/**
 * Every API module, registered in this order under the /v1 prefix by buildApp(). Each module owns
 * its path segments (e.g. the curb module serves /v1/curb/...). Add new modules here, never by
 * registering routes directly on the root instance.
 */
export const apiModules: readonly ApiModule[] = [
  {
    name: 'auth',
    summary: 'OIDC sign-in (Microsoft Entra, dev IdP), callback, logout; external identities.',
    plugin: authModule,
  },
  {
    name: 'orgs',
    summary: 'Organizations (tenants): creation, profile, workspace selection.',
    plugin: orgsModule,
  },
  { name: 'team', summary: 'Memberships, invitations, roles, revocation.', plugin: teamModule },
  {
    name: 'session',
    summary: 'Current session, signed-in user, active workspace switching.',
    plugin: sessionModule,
  },
  {
    name: 'flags',
    summary: 'Feature flags and entitlements by tenant and jurisdiction.',
    plugin: flagsModule,
  },
  {
    name: 'audit',
    summary: 'Audit event queries (writes happen inside each module transaction).',
    plugin: auditModule,
  },
  {
    name: 'media',
    summary: 'Photo and document metadata, EXIF, thumbnails, photo-quality results.',
    plugin: mediaModule,
  },
  {
    name: 'storage',
    summary: 'Signed upload/download URLs for the StorageAdapter.',
    plugin: storageModule,
  },
  {
    name: 'imagery',
    summary: 'Imagery providers and the imagery rights engine.',
    plugin: imageryModule,
  },
  {
    name: 'properties',
    summary: 'Properties, addresses and structures.',
    plugin: propertiesModule,
  },
  {
    name: 'roof',
    summary:
      'Traced roof measurements: orders, versioned facet geometry, approval and priced estimates.',
    plugin: roofModule,
  },
  {
    name: 'curb',
    summary: 'Curb projects, guided photos, calibrations and curb segments.',
    plugin: curbModule,
  },
  {
    name: 'pricebooks',
    summary: 'Regional price books with immutable revisions.',
    plugin: pricebooksModule,
  },
  {
    name: 'estimates',
    summary: 'Estimates (low/base/high scenarios), gating and approval requests.',
    plugin: estimatesModule,
  },
  { name: 'approvals', summary: 'Role-based approvals and review gates.', plugin: approvalsModule },
  { name: 'crm', summary: 'Contacts, leads and pipeline.', plugin: crmModule },
  { name: 'jobs', summary: 'Jobs, work orders and dispatch prerequisites.', plugin: jobsModule },
  {
    name: 'supplierOrders',
    summary: 'Supplier material order drafts (off by default behind ops.supplier_orders).',
    plugin: supplierOrdersModule,
  },
  {
    name: 'externalBids',
    summary: 'Official read-only outside procurement feeds.',
    plugin: externalBidsModule,
  },
  {
    name: 'permitLeads',
    summary: 'Texas permit job search: public permits ranked into early-stage jobs with outreach kits.',
    plugin: permitLeadsModule,
  },
  {
    name: 'invoiceIntel',
    summary: 'Invoice Intelligence: bulk invoice import, review queue and Analysis.',
    plugin: invoiceIntelModule,
  },
  {
    name: 'outreach',
    summary: 'Bid outreach: daily Texas company list, email and call outreach, replies and offers.',
    plugin: outreachModule,
  },
  {
    name: 'proposals',
    summary: 'Proposals: drafting, sending, acceptance.',
    plugin: proposalsModule,
  },
  {
    name: 'signatures',
    summary: 'Signature adapter and signing certificates.',
    plugin: signaturesModule,
  },
  {
    name: 'invoices',
    summary: 'Invoices created from accepted proposals.',
    plugin: invoicesModule,
  },
  {
    name: 'bills',
    summary: 'Bills received from connected companies: approve, dispute, pay, ledger.',
    plugin: billsModule,
  },
  {
    name: 'network',
    summary: 'Opt-in contractor directory, company connections and shared projects.',
    plugin: networkModule,
  },
  {
    name: 'plumbing',
    summary: 'Plumbing projects, calibrated plans, design revisions, estimates and approvals.',
    plugin: plumbingModule,
  },
  {
    name: 'payments',
    summary: 'Payment adapter, provider webhooks and payment ledger.',
    plugin: paymentsModule,
  },
  {
    name: 'changeorders',
    summary: 'Change orders against approved scope.',
    plugin: changeordersModule,
  },
  {
    name: 'portal',
    summary: 'Homeowner portal (a non-member principal with its own access rules).',
    plugin: portalModule,
  },
  {
    name: 'notifications',
    summary: 'Email and in-app notifications delivered through the job outbox.',
    plugin: notificationsModule,
  },
  { name: 'dashboard', summary: 'KPIs derived from auditable events.', plugin: dashboardModule },
  { name: 'search', summary: 'Tenant-scoped global search.', plugin: searchModule },
  {
    name: 'billing',
    summary: 'Platform subscription, report credits and usage ledger.',
    plugin: billingModule,
  },
  { name: 'exports', summary: 'Data exports and PDF generation.', plugin: exportsModule },
  {
    name: 'reviews',
    summary: 'Human review queues for measurements and estimates.',
    plugin: reviewsModule,
  },
  {
    name: 'vision',
    summary: 'Vision worker client; recognizers abstain unless a registered model is enabled.',
    plugin: visionModule,
  },
  {
    name: 'userDrafts',
    summary: 'Signed-in personal workspace draft autosave and recovery.',
    plugin: userDraftsModule,
  },
  {
    name: 'mailboxes',
    summary:
      'Your own Gmail / Outlook connections for emailing invoices (tokens live in apps/mailer).',
    plugin: mailboxesModule,
  },
  {
    name: 'enterprise',
    summary: 'Opt-in commercial construction project controls and preliminary SOV.',
    plugin: enterpriseModule,
  },
  { name: 'admin', summary: 'Platform administration and support tools.', plugin: adminModule },
  {
    name: 'homeBuilder',
    summary: 'AI Home Builder: versioned home projects, brief planning, IFC import/export.',
    plugin: homeBuilderModule,
  },
  {
    name: 'roofDamage',
    summary: 'Roof damage photo check: vision-model findings and optional cost from measured area.',
    plugin: roofDamageModule,
  },
  {
    name: 'assistant',
    summary: 'Ask Field Pro: AI answers for general questions, home building and search help.',
    plugin: assistantModule,
  },
  {
    name: 'projectManagement',
    summary: 'Job project controls: RFIs, submittals, Gantt schedule, daily logs, drawings, punch lists, checklists, crew scheduling, fleet.',
    plugin: projectManagementModule,
  },
  {
    name: 'landScout',
    summary: 'Land Scout buy-box engine: Texas CAD parcels scored and ranked, due-diligence reports, owner lookup guidance.',
    plugin: landScoutModule,
  },
  {
    name: 'landFeasibility',
    summary: 'Saved land-feasibility projects: named snapshots of a feasibility run (inputs plus client-computed summary) to flip between.',
    plugin: landFeasibilityModule,
  },
  {
    name: 'planToBid',
    summary: 'Plan-to-Bid: read an uploaded construction plan into a review-ready takeoff, estimate and draft bid package by trade.',
    plugin: planToBidModule,
  },
  {
    name: 'govOpportunities',
    summary: 'Gov Opportunities: daily .gov dead-link scan plus SAM.gov / CMBL listing presence — the app finds listing opportunities and tells the contractor.',
    plugin: govOpportunitiesModule,
  },
  {
    name: 'roofStorms',
    summary: 'Roofing hailstorms: NOAA SPC hail events, impact matching against company properties, revenue estimate, and gated Storm Response SMS.',
    plugin: roofStormsModule,
  },
  {
    name: 'roofClaims',
    summary: 'Roof insurance claims per roof job with evidence documents, plus per-agent time-saved tracking from logged automation actions.',
    plugin: roofClaimsModule,
  },
  {
    name: 'followUps',
    summary: 'Roofing follow-up queue: quoted-not-won and dry leads resurface for timed re-contact with templates; automation off by default.',
    plugin: followUpsModule,
  },
  {
    name: 'inspections',
    summary: 'Roof inspection booking: book, confirm, and cancel inspections in-app (Front Desk booking flow; no telephony).',
    plugin: inspectionsModule,
  },
  {
    name: 'voiceFrontDesk',
    summary:
      'Voice front desk: provider-agnostic incoming-call webhook + status. Gated off (503 dependency_unavailable) until a telephony provider is connected and the webhook is explicitly enabled.',
    plugin: voiceFrontDeskModule,
  },
  {
    name: 'gisWorkbench',
    summary:
      'GIS Workbench: view-scale map layers (CAD parcels, USGS NHD streams, saved traced roofs) and DRAFT plan-sheet PDF export.',
    plugin: gisWorkbenchModule,
  },
  {
    name: 'warranty',
    summary:
      'Warranty + homeowner service: warranty tickets against jobs, service work orders, and the staff/homeowner message thread; homeowners file through the existing job-status portal link.',
    plugin: warrantyModule,
  },
  {
    name: 'jobCost',
    summary:
      'Job cost + draws + AP + lien releases: budget-to-actual per cost code, progress-billing draws, AP capture/approval/payment-recorded (money movement gated), lien-waiver document tracking.',
    plugin: jobCostModule,
  },
  {
    name: 'homeSales',
    summary:
      'Home-sales pipeline + design center: prospects with buyer/agent dual tracking, appointments, the builder\u2019s options catalog, sales contracts with priced selections.',
    plugin: homeSalesModule,
  },
  {
    name: 'supplierFlow',
    summary:
      'Supplier order flow between connected companies: PO send/accept/status with history, SKU mapping, lite dispatch routes, supplier field reports. Email gated on the mailer.',
    plugin: supplierFlowModule,
  },
  {
    name: 'landManagement',
    summary:
      'Land management: communities \u2192 phases \u2192 lots \u2192 houses with full detail records, land development contracts with progress pay, SWPPP inspections.',
    plugin: landManagementModule,
  },
  {
    name: 'attention',
    summary:
      'Proactive attention feed computed from company records (slipping schedules, outstanding POs, overdue AP, waiting warranty, draws, at-risk contracts, SWPPP) with provenance labels and an optional AI summary.',
    plugin: attentionModule,
  },
  {
    name: 'fieldOps',
    summary:
      'Field operations: mobile time tracking with labor cost allocation, generic inspection checklists (templates + results).',
    plugin: fieldOpsModule,
  },
  {
    name: 'assignments',
    summary:
      'Work assignments between connected companies (job/PO/task/bid): in-app notification immediately, email through the mailer path when connected, honest not_connected state until then.',
    plugin: assignmentsModule,
  },
  {
    name: 'integrations',
    summary:
      'Gated integrations: QuickBooks Online sync (needs the owner\u2019s Intuit OAuth app) and the B2B payments rail (needs a regulated provider). Both report honest not_connected states until set up.',
    plugin: integrationsModule,
  },
];
