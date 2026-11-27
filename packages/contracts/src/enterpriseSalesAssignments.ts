import { z } from 'zod';

const id = z.uuid();
const revision = z.number().int().positive();
const reason = z.string().trim().min(3).max(1000);
const person = z.object({ id, name: z.string() });
const positiveCapacity = z.number().int().min(1).max(1000);

export const SalesTerritoryInput = z.strictObject({
  membershipId: id,
  communityId: id.nullable(),
  capacity: positiveCapacity,
  active: z.boolean(),
  reason,
  clientRequestId: id,
});
export const SalesTerritory = z.object({
  id,
  membership: person,
  community: person.nullable(),
  capacity: positiveCapacity,
  active: z.boolean(),
  revision,
  reason,
});
export const SalesTerritoryOptions = z.object({
  communities: z.array(person),
  salespeople: z.array(person),
  territories: z.array(SalesTerritory),
});

export const SetSalesAssignmentPolicy = z.strictObject({
  enabled: z.boolean(),
  reason,
  clientRequestId: id,
});
export const SalesAssignmentPolicy = z.object({
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  history: z.array(
    z.object({ enabled: z.boolean(), revision, reason, recordedAt: z.iso.datetime() }),
  ),
  activeTerritoryCount: z.number().int().nonnegative(),
});

const command = z.strictObject({ reason, clientRequestId: id });
export const AssignEnterpriseSalesLead = z.discriminatedUnion('mode', [
  command.extend({ mode: z.literal('direct'), ownerMembershipId: id }),
  command.extend({ mode: z.literal('round_robin') }),
]);
export const SalesLeadAssignment = z.object({
  id,
  revision,
  mode: z.enum(['direct', 'round_robin']),
  owner: person,
  previousOwnerMembershipId: id.nullable(),
  reason,
  assignedAt: z.iso.datetime(),
});
export const SalesLeadAssignmentOptions = z.object({
  id,
  name: z.string(),
  revision,
  owner: person.nullable(),
  roundRobinEnabled: z.boolean(),
  candidates: z.array(
    person.extend({ activeLeads: z.number().int().nonnegative(), capacity: positiveCapacity }),
  ),
  history: z.array(SalesLeadAssignment),
});
