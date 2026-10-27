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
import proposalsModule from './proposals';
import signaturesModule from './signatures';
import invoicesModule from './invoices';
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
    summary: 'Roof orders, reports, facet geometry revisions and takeoff.',
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
  { name: 'admin', summary: 'Platform administration and support tools.', plugin: adminModule },
];
