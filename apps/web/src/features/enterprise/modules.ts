import { getRoute } from '@fieldline/contracts';

export const PANELS = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Company opt-in and the enterprise workspaces',
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    description: '157 work packages, their fields and lifecycles, plus the control-level addendum',
    routeId: 'enterprise.blueprint',
  },
  { id: 'bim', label: 'BIM & 3D', description: 'Structural, MEP and building models' },
  {
    id: 'takeoff',
    label: 'Digital Takeoff',
    description: 'Measured 2D plans, assemblies and pricing',
  },
  { id: 'controls', label: 'Project Controls', description: 'RFIs, submittals and change orders' },
  {
    id: 'change-orders',
    label: 'Change Orders',
    description: 'Company and project queues, decisions, and audit history',
    routeId: 'enterprise.changeOrders',
  },
  {
    id: 'field',
    label: 'Field Execution',
    description: 'Punch items, floor-plan pins and daily logs',
  },
  { id: 'vault', label: 'Document Vault', description: 'Immutable version history and compliance' },
  {
    id: 'scheduling',
    label: 'Scheduling',
    description: 'Task dependencies, forecast dates, and baselines',
    routeId: 'enterprise.scheduling',
  },
  {
    id: 'costing',
    label: 'Job Costing',
    description: 'Schedule of values, retainage and forecasts',
  },
] as const;

export type EnterpriseArea = (typeof PANELS)[number]['id'];
export type EnterprisePanel = (typeof PANELS)[number];

/** Registry route when the panel has one; the remaining panels keep their section paths. */
export function panelHref(panel: EnterprisePanel): string {
  if ('routeId' in panel) return getRoute(panel.routeId).path;
  return panel.id === 'overview' ? '/enterprise' : `/enterprise/${panel.id}`;
}
