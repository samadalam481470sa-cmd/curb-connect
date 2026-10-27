// Tables owned by the `team` module (PLT-015, PLT-016): memberships, invitations, role bundles,
// per-member permission overrides and approval delegations.
import { sql } from 'drizzle-orm';
import { boolean, foreignKey, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { minorUnits, revisionColumn, tsColumn } from './_columns';
import {
  approvalSubjectTypeEnum,
  invitationStatusEnum,
  memberRoleEnum,
  membershipStatusEnum,
  permissionEffectEnum,
} from './_enums';
import { pgName, tenantTable } from './_tenant';
import { users } from './auth';

/** Named bundles of actions an admin can assign on top of the base role. */
export const roleBundles = tenantTable(
  'role_bundles',
  {
    name: text('name').notNull(),
    description: text('description'),
    baseRole: memberRoleEnum('base_role').notNull(),
    actions: text('actions').array().notNull().default(sql`'{}'`),
    isSystem: boolean('is_system').notNull().default(false),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('orgId', 'name')],
);

export const memberships = tenantTable(
  'memberships',
  {
    userId: uuid('user_id').notNull(),
    role: memberRoleEnum('role').notNull(),
    status: membershipStatusEnum('status').notNull().default('active'),
    title: text('title'),
    roleBundleId: uuid('role_bundle_id'),
    invitedByUserId: uuid('invited_by_user_id'),
    joinedAt: tsColumn('joined_at').notNull().defaultNow(),
    suspendedAt: tsColumn('suspended_at'),
    revision: revisionColumn(),
  },
  (t, h) => [
    h.uniq('orgId', 'userId'),
    h.idx('userId'),
    foreignKey({
      name: pgName('memberships_user_fk'),
      columns: [t.userId],
      foreignColumns: [users.id],
    }).onDelete('restrict'),
    h.fk('roleBundleId', () => roleBundles),
  ],
);

export const invitations = tenantTable(
  'invitations',
  {
    email: text('email').notNull(),
    role: memberRoleEnum('role').notNull(),
    status: invitationStatusEnum('status').notNull().default('pending'),
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: uuid('invited_by_user_id').notNull(),
    expiresAt: tsColumn('expires_at').notNull(),
    acceptedAt: tsColumn('accepted_at'),
    acceptedByUserId: uuid('accepted_by_user_id'),
    revokedAt: tsColumn('revoked_at'),
    revision: revisionColumn(),
  },
  (_t, h) => [h.uniq('tokenHash'), h.idx('orgId', 'status')],
);

/** Explicit grant/deny of one RBAC action for one membership. Deny always wins. */
export const permissionOverrides = tenantTable(
  'permission_overrides',
  {
    membershipId: uuid('membership_id').notNull(),
    action: text('action').notNull(),
    effect: permissionEffectEnum('effect').notNull(),
    reason: text('reason'),
    grantedByUserId: uuid('granted_by_user_id'),
    expiresAt: tsColumn('expires_at'),
  },
  (_t, h) => [h.uniq('membershipId', 'action'), h.fk('membershipId', () => memberships, 'cascade')],
);

/** Temporary delegation of approval authority, optionally capped by amount. */
export const approvalDelegations = tenantTable(
  'approval_delegations',
  {
    fromMembershipId: uuid('from_membership_id').notNull(),
    toMembershipId: uuid('to_membership_id').notNull(),
    subjectTypes: approvalSubjectTypeEnum('subject_types').array().notNull(),
    maxAmountMinor: minorUnits('max_amount_minor'),
    startsAt: tsColumn('starts_at').notNull(),
    endsAt: tsColumn('ends_at').notNull(),
    reason: text('reason'),
    revokedAt: tsColumn('revoked_at'),
    conditions: jsonb('conditions'),
  },
  (_t, h) => [
    h.fk('fromMembershipId', () => memberships),
    h.fk('toMembershipId', () => memberships),
    h.idx('toMembershipId'),
  ],
);
