// Every API path the web shell calls, in one file, typed against @fieldline/contracts. The API's
// auth/orgs/team/me modules are written in parallel from the same contracts; where a contract does
// not exist yet (auth providers, invitation preview, settings envelope) the schema is defined here
// and listed in the web README so the API and contracts owners can adopt or correct it.
import {
  AcceptInvitationRequestSchema,
  BillListSchema,
  BillSchema,
  CalibratePlanRequestSchema,
  CompanyDirectoryResponseSchema,
  ComputeEstimateRequestSchema,
  CreatePlumbingProjectRequestSchema,
  CreateRevisionRequestSchema,
  ConnectionListSchema,
  ConnectionSchema,
  CreateConnectionRequestSchema,
  CreateNetworkInvoiceRequestSchema,
  CreateNetworkProjectRequestSchema,
  CreatePaymentLinkRequestSchema,
  DisputeBillRequestSchema,
  IssuedInvoiceListSchema,
  IssuedInvoiceSchema,
  LedgerResponseSchema,
  NetworkProjectListSchema,
  NetworkProjectSchema,
  PaymentLinkSchema,
  RecordSettlementRequestSchema,
  SendInvoiceRequestSchema,
  CreateInvitationRequestSchema,
  CreateOrganizationRequestSchema,
  CreateUploadRequestSchema,
  CreateUploadResponseSchema,
  DashboardResponseSchema,
  IdentityProviderSchema,
  InvitationListSchema,
  InvitationSchema,
  MemberListSchema,
  MemberRoleSchema,
  MemberSchema,
  MeResponseSchema,
  MembershipSummarySchema,
  NotificationPreferenceSchema,
  OrganizationSchema,
  OrgSettingsSchema,
  PlanVersionSchema,
  PlumbingEstimateRecordSchema,
  PlumbingProjectDetailSchema,
  PlumbingProjectListSchema,
  PlumbingProjectSchema,
  PlumbingRevisionSchema,
  SearchResponseSchema,
  UpdateMemberRequestSchema,
  UpdateNotificationPreferencesRequestSchema,
  UpdateOrganizationRequestSchema,
} from '@fieldline/contracts';
import { z } from 'zod';
import type { ApiClient } from './api';

/** Settings sections the API versions independently (PUT /v1/orgs/current/settings/:section). */
export type OrgSettingsSection =
  'general' | 'estimating' | 'billing' | 'notifications' | 'onboarding';

export const API_PATHS = {
  authProviders: '/v1/auth/providers',
  authLogin: (provider: string) => `/v1/auth/login/${encodeURIComponent(provider)}`,
  authLogout: '/v1/auth/logout',
  me: '/v1/me',
  meWorkspace: '/v1/session/active-org',
  meNotificationPreferences: '/v1/notifications/preferences',
  orgs: '/v1/orgs',
  // The API scopes company reads/writes to the session's active workspace (never an id in the path),
  // so `orgId` only guards that the caller switched first; it is not sent.
  org: (_orgId: string) => '/v1/orgs/current',
  orgSettings: (_orgId: string) => '/v1/orgs/current/settings',
  orgSettingsSection: (section: OrgSettingsSection) =>
    `/v1/orgs/current/settings/${encodeURIComponent(section)}`,
  members: '/v1/team/members',
  member: (membershipId: string) => `/v1/team/members/${encodeURIComponent(membershipId)}`,
  invitations: '/v1/team/invitations',
  invitationRevoke: (id: string) => `/v1/team/invitations/${encodeURIComponent(id)}/revoke`,
  transferOwnership: '/v1/team/transfer-ownership',
  /** POST with the token in the body, so the secret never appears in URLs or access logs. */
  invitationPreview: '/v1/invitations/preview',
  invitationAccept: '/v1/invitations/accept',
  dashboard: '/v1/dashboard',
  search: '/v1/search',
  mediaUploads: '/v1/media/uploads',

  // cross-company network (workstreams 06-09)
  directory: '/v1/network/directory',
  networkListing: '/v1/network/listing',
  connections: '/v1/network/connections',
  connectionAccept: (id: string) => `/v1/network/connections/${encodeURIComponent(id)}/accept`,
  connectionDecline: (id: string) => `/v1/network/connections/${encodeURIComponent(id)}/decline`,
  connectionRevoke: (id: string) => `/v1/network/connections/${encodeURIComponent(id)}/revoke`,
  networkProjects: '/v1/network/projects',
  plumbingProjects: '/v1/plumbing/projects',
  plumbingProject: (id: string) => `/v1/plumbing/projects/${encodeURIComponent(id)}`,
  plumbingPlan: (id: string) =>
    `/v1/plumbing/projects/${encodeURIComponent(id)}/plan`,
  plumbingRevisions: (id: string) =>
    `/v1/plumbing/projects/${encodeURIComponent(id)}/revisions`,
  plumbingEstimates: (id: string) =>
    `/v1/plumbing/projects/${encodeURIComponent(id)}/estimates`,
  plumbingEstimateApprove: (id: string, estimateId: string) =>
    `/v1/plumbing/projects/${encodeURIComponent(id)}/estimates/${encodeURIComponent(estimateId)}/approve`,
  invoices: '/v1/invoices',
  invoice: (id: string) => `/v1/invoices/${encodeURIComponent(id)}`,
  invoiceSend: (id: string) => `/v1/invoices/${encodeURIComponent(id)}/send`,
  bills: '/v1/bills',
  bill: (id: string) => `/v1/bills/${encodeURIComponent(id)}`,
  billView: (id: string) => `/v1/bills/${encodeURIComponent(id)}/view`,
  billApprove: (id: string) => `/v1/bills/${encodeURIComponent(id)}/approve`,
  billDispute: (id: string) => `/v1/bills/${encodeURIComponent(id)}/dispute`,
  billPaymentLink: (id: string) => `/v1/bills/${encodeURIComponent(id)}/payment-link`,
  billSettle: (id: string) => `/v1/bills/${encodeURIComponent(id)}/settle`,
  ledger: '/v1/ledger',
} as const;

// ---------------------------------------------------------------- schemas not yet in contracts
/** GET /v1/auth/providers. Proposed contract (no AuthProvider DTO exists in contracts yet). */
export const AuthProviderSchema = z
  .object({
    id: IdentityProviderSchema,
    label: z.string(),
    /** Where the browser goes to start the OIDC flow; defaults to API_PATHS.authLogin(id). */
    loginUrl: z.string().optional(),
    /** Dev-only providers (the local stand-in IdP) must be visibly labelled. */
    development: z.boolean().optional(),
    /** API field names: whether the provider is configured, and whether it is dev-only. */
    available: z.boolean().optional(),
    developmentOnly: z.boolean().optional(),
  })
  .transform(({ available, developmentOnly, ...p }) => ({
    ...p,
    development: p.development ?? developmentOnly,
    available: available ?? true,
  }));
export type AuthProvider = z.output<typeof AuthProviderSchema>;
/** Unconfigured providers are dropped: a button that cannot sign in would be a dead end. */
export const AuthProvidersResponseSchema = z
  .object({ providers: z.array(AuthProviderSchema) })
  .transform((r) => ({ providers: r.providers.filter((p) => p.available) }));

/** GET /v1/invitations/:token: what the invitee may see before accepting. Proposed contract. */
export const InvitationPreviewSchema = z.object({
  orgDisplayName: z.string(),
  role: MemberRoleSchema,
  status: InvitationSchema.shape.status,
  expiresAt: z.string(),
  invitedByName: z.string().nullable().optional(),
});
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;

export const NotificationPreferencesResponseSchema = z.object({
  preferences: z.array(NotificationPreferenceSchema),
});

export type CreateOrganizationInput = z.input<typeof CreateOrganizationRequestSchema>;
export type UpdateOrganizationInput = z.input<typeof UpdateOrganizationRequestSchema>;
export type UpdateMemberInput = z.input<typeof UpdateMemberRequestSchema>;
export type CreateInvitationInput = z.input<typeof CreateInvitationRequestSchema>;
export type CreateUploadInput = z.input<typeof CreateUploadRequestSchema>;
export type NotificationPreference = z.infer<typeof NotificationPreferenceSchema>;

/** Sorts sign-in providers: Microsoft first (owner decision), dev-only providers last. */
export function orderProviders(providers: readonly AuthProvider[]): AuthProvider[] {
  const rank = (p: AuthProvider) => (p.id === 'microsoft' ? 0 : p.development ? 2 : 1);
  return [...providers].sort((a, b) => rank(a) - rank(b));
}

export function createEndpoints(api: ApiClient) {
  return {
    authProviders: () => api.get(API_PATHS.authProviders, { schema: AuthProvidersResponseSchema }),
    logout: () => api.post(API_PATHS.authLogout),
    me: () => api.get(API_PATHS.me, { schema: MeResponseSchema }),
    switchWorkspace: (orgId: string) =>
      api.post(API_PATHS.meWorkspace, { orgId }, { schema: MeResponseSchema }),

    createOrganization: (input: CreateOrganizationInput, idempotencyKey: string) =>
      api.post(API_PATHS.orgs, CreateOrganizationRequestSchema.parse(input), {
        schema: OrganizationSchema,
        idempotencyKey,
      }),
    organization: (orgId: string) => api.get(API_PATHS.org(orgId), { schema: OrganizationSchema }),
    updateOrganization: (orgId: string, input: UpdateOrganizationInput, revision: number) =>
      api.patch(API_PATHS.org(orgId), UpdateOrganizationRequestSchema.parse(input), {
        schema: OrganizationSchema,
        ifMatch: revision,
      }),
    orgSettings: (orgId: string) =>
      api.get(API_PATHS.orgSettings(orgId), { schema: OrgSettingsSchema }),
    /** Settings are versioned server-side (PLT-014 R): each save creates a new revision. */
    saveOrgSettings: (
      section: OrgSettingsSection,
      settings: Record<string, unknown>,
      changeReason: string,
      revisionNumber?: number,
    ) =>
      api.put(
        API_PATHS.orgSettingsSection(section),
        { settings, changeReason },
        { schema: OrgSettingsSchema, ifMatch: revisionNumber },
      ),

    members: () => api.get(API_PATHS.members, { schema: MemberListSchema, query: { limit: 100 } }),
    updateMember: (membershipId: string, input: UpdateMemberInput, revision: number) =>
      api.patch(API_PATHS.member(membershipId), UpdateMemberRequestSchema.parse(input), {
        schema: MemberSchema,
        ifMatch: revision,
      }),
    invitations: () =>
      api.get(API_PATHS.invitations, { schema: InvitationListSchema, query: { limit: 100 } }),
    createInvitation: (input: CreateInvitationInput, idempotencyKey: string) =>
      api.post(API_PATHS.invitations, CreateInvitationRequestSchema.parse(input), {
        schema: InvitationSchema,
        idempotencyKey,
      }),
    revokeInvitation: (invitationId: string) =>
      api.post(API_PATHS.invitationRevoke(invitationId), undefined, { schema: InvitationSchema }),
    transferOwnership: (toMembershipId: string, idempotencyKey: string) =>
      api.post(API_PATHS.transferOwnership, { toMembershipId }, { idempotencyKey }),

    invitationPreview: (token: string) =>
      api.post(API_PATHS.invitationPreview, AcceptInvitationRequestSchema.parse({ token }), {
        schema: InvitationPreviewSchema,
      }),
    acceptInvitation: (token: string, idempotencyKey: string) =>
      api.post(API_PATHS.invitationAccept, AcceptInvitationRequestSchema.parse({ token }), {
        schema: MembershipSummarySchema,
        idempotencyKey,
      }),

    dashboard: () => api.get(API_PATHS.dashboard, { schema: DashboardResponseSchema }),
    search: (q: string, signal?: AbortSignal) =>
      api.get(API_PATHS.search, { schema: SearchResponseSchema, query: { q, limit: 20 }, signal }),

    notificationPreferences: () =>
      api.get(API_PATHS.meNotificationPreferences, {
        schema: NotificationPreferencesResponseSchema,
      }),
    updateNotificationPreferences: (preferences: NotificationPreference[]) =>
      api.put(
        API_PATHS.meNotificationPreferences,
        UpdateNotificationPreferencesRequestSchema.parse({ preferences }),
        { schema: NotificationPreferencesResponseSchema },
      ),

    directory: (q?: string) =>
      api.get(API_PATHS.directory, {
        schema: CompanyDirectoryResponseSchema,
        query: { limit: 25, ...(q ? { q } : {}) },
      }),
    updateNetworkListing: (input: { directoryOptIn: boolean; serviceArea?: string | null }) =>
      api.patch(API_PATHS.networkListing, input, {
        schema: z.object({ directoryOptIn: z.boolean(), serviceArea: z.string().nullable() }),
      }),
    connections: (status?: 'pending' | 'active' | 'declined' | 'revoked') =>
      api.get(API_PATHS.connections, {
        schema: ConnectionListSchema,
        query: { limit: 100, ...(status ? { status } : {}) },
      }),
    requestConnection: (
      input: { partnerOrgId: string; scopes?: string[]; message?: string },
      idempotencyKey: string,
    ) =>
      api.post(API_PATHS.connections, CreateConnectionRequestSchema.parse(input), {
        schema: ConnectionSchema,
        idempotencyKey,
      }),
    acceptConnection: (id: string) =>
      api.post(API_PATHS.connectionAccept(id), undefined, { schema: ConnectionSchema }),
    declineConnection: (id: string) =>
      api.post(API_PATHS.connectionDecline(id), undefined, { schema: ConnectionSchema }),
    revokeConnection: (id: string) =>
      api.post(API_PATHS.connectionRevoke(id), undefined, { schema: ConnectionSchema }),
    networkProjects: () =>
      api.get(API_PATHS.networkProjects, { schema: NetworkProjectListSchema }),
    shareNetworkProject: (
      input: {
        connectionId: string;
        name: string;
        clientName?: string;
        siteAddress?: string;
        contractValueMinor?: number;
      },
      idempotencyKey: string,
    ) =>
      api.post(API_PATHS.networkProjects, CreateNetworkProjectRequestSchema.parse(input), {
        schema: NetworkProjectSchema,
        idempotencyKey,
      }),

    plumbingProjects: () =>
      api.get(API_PATHS.plumbingProjects, { schema: PlumbingProjectListSchema }),
    createPlumbingProject: (
      input: z.input<typeof CreatePlumbingProjectRequestSchema>,
      idempotencyKey: string,
    ) =>
      api.post(API_PATHS.plumbingProjects, CreatePlumbingProjectRequestSchema.parse(input), {
        schema: PlumbingProjectSchema,
        idempotencyKey,
      }),
    plumbingProject: (id: string) =>
      api.get(API_PATHS.plumbingProject(id), { schema: PlumbingProjectDetailSchema }),
    calibratePlan: (id: string, input: z.input<typeof CalibratePlanRequestSchema>) =>
      api.post(API_PATHS.plumbingPlan(id), CalibratePlanRequestSchema.parse(input), {
        schema: PlanVersionSchema,
      }),
    createPlumbingRevision: (
      id: string,
      input: z.input<typeof CreateRevisionRequestSchema>,
      idempotencyKey: string,
    ) =>
      api.post(API_PATHS.plumbingRevisions(id), CreateRevisionRequestSchema.parse(input), {
        schema: PlumbingRevisionSchema,
        idempotencyKey,
      }),
    computePlumbingEstimate: (id: string, input: z.input<typeof ComputeEstimateRequestSchema>) =>
      api.post(API_PATHS.plumbingEstimates(id), ComputeEstimateRequestSchema.parse(input), {
        schema: PlumbingEstimateRecordSchema,
      }),
    approvePlumbingEstimate: (id: string, estimateId: string) =>
      api.post(API_PATHS.plumbingEstimateApprove(id, estimateId), undefined, {
        schema: PlumbingEstimateRecordSchema,
      }),

    invoices: (status?: string) =>
      api.get(API_PATHS.invoices, {
        schema: IssuedInvoiceListSchema,
        query: { limit: 50, ...(status ? { status } : {}) },
      }),
    invoice: (id: string) => api.get(API_PATHS.invoice(id), { schema: IssuedInvoiceSchema }),
    createInvoice: (
      input: z.input<typeof CreateNetworkInvoiceRequestSchema>,
      idempotencyKey: string,
    ) =>
      api.post(API_PATHS.invoices, CreateNetworkInvoiceRequestSchema.parse(input), {
        schema: IssuedInvoiceSchema,
        idempotencyKey,
      }),
    sendInvoice: (id: string, message?: string) =>
      api.post(API_PATHS.invoiceSend(id), SendInvoiceRequestSchema.parse({ message }), {
        schema: IssuedInvoiceSchema,
      }),

    bills: (status?: 'received' | 'approved' | 'disputed' | 'paid' | 'void') =>
      api.get(API_PATHS.bills, {
        schema: BillListSchema,
        query: { limit: 50, ...(status ? { status } : {}) },
      }),
    bill: (id: string) => api.get(API_PATHS.bill(id), { schema: BillSchema }),
    viewBill: (id: string) => api.post(API_PATHS.billView(id), undefined, { schema: BillSchema }),
    approveBill: (id: string, comment?: string) =>
      api.post(API_PATHS.billApprove(id), { comment }, { schema: BillSchema }),
    disputeBill: (id: string, reason: string) =>
      api.post(API_PATHS.billDispute(id), DisputeBillRequestSchema.parse({ reason }), {
        schema: BillSchema,
      }),
    createPaymentLink: (id: string, idempotencyKey: string) =>
      api.post(API_PATHS.billPaymentLink(id), CreatePaymentLinkRequestSchema.parse({}), {
        schema: PaymentLinkSchema,
        idempotencyKey,
      }),
    settleBill: (
      id: string,
      method: 'bank_transfer' | 'check' | 'cash' | 'card_stand_in',
      reference?: string,
      idempotencyKey?: string,
    ) =>
      api.post(API_PATHS.billSettle(id), RecordSettlementRequestSchema.parse({ method, reference }), {
        schema: BillSchema,
        idempotencyKey,
      }),
    ledger: () => api.get(API_PATHS.ledger, { schema: LedgerResponseSchema }),

    createUpload: (input: CreateUploadInput, idempotencyKey: string) =>
      api.post(API_PATHS.mediaUploads, CreateUploadRequestSchema.parse(input), {
        schema: CreateUploadResponseSchema,
        idempotencyKey,
      }),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
