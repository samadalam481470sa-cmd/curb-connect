// Every API path the web shell calls, in one file, typed against @fieldline/contracts. The API's
// auth/orgs/team/me modules are written in parallel from the same contracts; where a contract does
// not exist yet (auth providers, invitation preview, settings envelope) the schema is defined here
// and listed in the web README so the API and contracts owners can adopt or correct it.
import {
  AcceptInvitationRequestSchema,
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

    createUpload: (input: CreateUploadInput, idempotencyKey: string) =>
      api.post(API_PATHS.mediaUploads, CreateUploadRequestSchema.parse(input), {
        schema: CreateUploadResponseSchema,
        idempotencyKey,
      }),
  };
}

export type Endpoints = ReturnType<typeof createEndpoints>;
