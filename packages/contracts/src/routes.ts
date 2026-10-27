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
  /** Shown in the phone bottom bar (at most five). */
  mobileBottomNav?: boolean;
  /** Short icon name for packages/ui (generic names, not brand assets). */
  icon?: string;
  requirementIds: readonly string[];
}

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
    id: 'leads',
    path: '/leads',
    label: 'Leads',
    permission: 'lead:read',
    featureFlag: 'crm.leads',
    analyticsEvent: 'leads_viewed',
    nav: 'primary',
    navOrder: 40,
    icon: 'inbox',
    requirementIds: ['PLT-011', 'OPS-061'],
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
    mobileBottomNav: true,
    icon: 'board',
    requirementIds: ['PLT-011', 'OPS-062'],
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
    icon: 'document',
    requirementIds: ['PLT-011', 'OPS-063'],
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
    icon: 'receipt',
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
    mobileBottomNav: true,
    icon: 'settings',
    requirementIds: ['PLT-011', 'PLT-014'],
  },
] as const satisfies readonly RouteDefinition[];

/** Deep-linkable detail and flow routes. `:param` segments are filled by routePath(). */
export const DETAIL_ROUTES = [
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
] as const satisfies readonly RouteDefinition[];

/** Routes outside the signed-in shell (no membership required). */
export const PUBLIC_PATHS = {
  signIn: '/sign-in',
  selectWorkspace: '/select-workspace',
  accessDenied: '/access',
  invitation: '/invite/:token',
  portal: '/portal/:token',
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
      availability: !route.featureFlag || isFlagEnabled(route.featureFlag) ? 'available' : 'unavailable',
    }));
}
