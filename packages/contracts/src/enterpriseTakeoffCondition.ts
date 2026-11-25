import { z } from 'zod';

export const EnterpriseTakeoffConditionKind = z.enum([
  'floor',
  'room',
  'material',
  'phase',
  'trade',
  'alternate',
]);
const ConditionFields = z.object({
  kind: EnterpriseTakeoffConditionKind,
  name: z.string().trim().min(2).max(100),
  parentFloorId: z.uuid().nullable(),
});
export const EnterpriseTakeoffConditionInput = ConditionFields.strict().refine(
  ({ kind, parentFloorId }) => (kind === 'room') === (parentFloorId !== null),
  { path: ['parentFloorId'], message: 'Only a room must have a parent floor.' },
);
export const EnterpriseTakeoffCondition = ConditionFields.extend({ id: z.uuid() });
export const EnterpriseTakeoffMeasurementKind = z.enum(['length', 'area', 'count']);

const AssignmentFields = z.object({
  measurementKind: EnterpriseTakeoffMeasurementKind,
  measurementId: z.uuid(),
  conditionId: z.uuid(),
  floorId: z.uuid().nullable(),
  roomId: z.uuid().nullable(),
});
export const EnterpriseTakeoffConditionAssignmentInput = AssignmentFields.strict();
export const EnterpriseTakeoffConditionAssignment = AssignmentFields.extend({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});
export const EnterpriseTakeoffTaggableMeasurement = z.object({
  id: z.uuid(),
  kind: EnterpriseTakeoffMeasurementKind,
  value: z.number().nonnegative(),
  unit: z.string().nullable(),
  revision: z.number().int().positive(),
  conditions: z.array(EnterpriseTakeoffConditionAssignment),
});
export const EnterpriseTakeoffConditionWorkspace = z.object({
  measurements: z.array(EnterpriseTakeoffTaggableMeasurement),
  conditions: z.array(EnterpriseTakeoffCondition),
  nextCursor: z.string().nullable(),
});
