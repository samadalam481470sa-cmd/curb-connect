// Every API path the web shell calls, in one file, typed against @fieldline/contracts. The API's
// auth/orgs/team/me modules are written in parallel from the same contracts; where a contract does
// not exist yet (auth providers, invitation preview, settings envelope) the schema is defined here
// and listed in the web README so the API and contracts owners can adopt or correct it.
import {
  AcceptInvitationRequestSchema,
  CreateCustomerRequestSchema,
  CreateInvitationRequestSchema,
  CreateLeadRequestSchema,
  CreateOrganizationRequestSchema,
  CreateUploadRequestSchema,
  CreateUploadResponseSchema,
  CustomerListSchema,
  CustomerSchema,
  DashboardResponseSchema,
  IdentityProviderSchema,
  InvitationListSchema,
  InvitationSchema,
  LeadListSchema,
  LeadSchema,
  MemberListSchema,
  MemberRoleSchema,
  MemberSchema,
  MeResponseSchema,
  MembershipSummarySchema,
  NotificationPreferenceSchema,
  OrganizationSchema,
  OrgSettingsSchema,
  PriceBookListSchema,
  PriceBookRevisionSchema,
  PriceBookSchema,
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
  /** Properties / geocode — may 404 until the properties module ships routes. */
  propertiesGeocode: '/v1/properties/geocode',
  customers: '/v1/customers',
  customer: (id: string) => `/v1/customers/${encodeURIComponent(id)}`,
  leads: '/v1/leads',
  lead: (id: string) => `/v1/leads/${encodeURIComponent(id)}`,
  priceBooks: '/v1/price-books',
  priceBook: (id: string) => `/v1/price-books/${encodeURIComponent(id)}`,
  priceBookRevisions: (id: string) => `/v1/price-books/${encodeURIComponent(id)}/revisions`,
  roofOrders: '/v1/roof/orders',
  roofOrder: (id: string) => `/v1/roof/orders/${encodeURIComponent(id)}`,
  curbProjects: '/v1/curb/projects',
  curbProject: (id: string) => `/v1/curb/projects/${encodeURIComponent(id)}`,
} as const;

export type CreateCustomerInput = z.input<typeof CreateCustomerRequestSchema>;
export type CreateLeadInput = z.input<typeof CreateLeadRequestSchema>;

/** Local org price-book draft shape when the API is unavailable. */
export const LocalPriceBookDraftSchema = z.object({
  wastePercent: z.string(),
  overheadPercent: z.string(),
  marginPercent: z.string(),
  laborRatePerSquare: z.string(),
  updatedAt: z.string(),
});
export type LocalPriceBookDraft = z.infer<typeof LocalPriceBookDraftSchema>;

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

    createUpload: (input: CreateUploadInput, idempotencyKey: string) =>
      api.post(API_PATHS.mediaUploads, CreateUploadRequestSchema.parse(input), {
        schema: CreateUploadResponseSchema,
        idempotencyKey,
      }),

    /** POST body `{ q }` — matches apps/api properties module. */
    geocode: (q: string, signal?: AbortSignal) =>
      api.post(
        API_PATHS.propertiesGeocode,
        { q },
        {
          schema: z.object({
            candidates: z.array(
              z.object({
                provider: z.string(),
                placeId: z.string(),
                displayName: z.string(),
                lat: z.number(),
                lng: z.number(),
                confidence: z.number().nullable().optional(),
              }),
            ),
            attribution: z.string().optional(),
          }),
          signal,
        },
      ),

    customers: (signal?: AbortSignal) =>
      api.get(API_PATHS.customers, { schema: CustomerListSchema, query: { limit: 100 }, signal }),
    createCustomer: (input: CreateCustomerInput, idempotencyKey: string) =>
      api.post(API_PATHS.customers, CreateCustomerRequestSchema.parse(input), {
        schema: CustomerSchema,
        idempotencyKey,
      }),

    leads: (signal?: AbortSignal) =>
      api.get(API_PATHS.leads, { schema: LeadListSchema, query: { limit: 100 }, signal }),
    createLead: (input: CreateLeadInput, idempotencyKey: string) =>
      api.post(API_PATHS.leads, CreateLeadRequestSchema.parse(input), {
        schema: LeadSchema,
        idempotencyKey,
      }),

    priceBooks: (signal?: AbortSignal) =>
      api.get(API_PATHS.priceBooks, { schema: PriceBookListSchema, query: { limit: 50 }, signal }),
    priceBook: (id: string) => api.get(API_PATHS.priceBook(id), { schema: PriceBookSchema }),
    priceBookRevision: (bookId: string, revisionId: string) =>
      api.get(`/v1/price-books/${encodeURIComponent(bookId)}/revisions/${encodeURIComponent(revisionId)}`, {
        schema: PriceBookRevisionSchema,
      }),

    /** Soft draft save for roof orders — graceful when route missing. */
    saveRoofOrderDraft: (orderId: string | null, body: unknown, idempotencyKey: string) =>
      orderId
        ? api.put(API_PATHS.roofOrder(orderId), body, { idempotencyKey })
        : api.post(API_PATHS.roofOrders, body, { idempotencyKey }),
    saveCurbProjectDraft: (projectId: string | null, body: unknown, idempotencyKey: string) =>
      projectId
        ? api.put(API_PATHS.curbProject(projectId), body, { idempotencyKey })
        : api.post(API_PATHS.curbProjects, body, { idempotencyKey }),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
