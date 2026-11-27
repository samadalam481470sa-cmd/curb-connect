// PLT-011: navigation derived from the route registry, the member's effective permissions and the
// organization's feature flags. Routes the role cannot open are omitted; routes whose flag is off
// stay visible but unavailable with a reason. Roof Measurements and Curb Cutting keep their
// registry positions (adjacent, directly after Home) on every breakpoint (PLT-011 A).
import {
  navigationTree,
  visibleNavigation,
  type Action,
  type FeatureFlagKey,
  type NavigationItem,
  type RouteDefinition,
} from '@fieldline/contracts';

export interface NavEntry {
  id: string;
  label: string;
  href: string;
  icon?: string;
  current: boolean;
  mobile: boolean;
  unavailableReason?: string;
}

export const FLAG_OFF_REASON = 'not enabled for your company yet';

function toEntry(
  { route, availability }: NavigationItem,
  currentPrimaryId: string | null,
): NavEntry {
  const r = route as RouteDefinition;
  return {
    id: r.id,
    label: r.label,
    href: r.path,
    icon: r.icon,
    current: r.id === currentPrimaryId,
    mobile: Boolean(r.mobileBottomNav),
    unavailableReason: availability === 'unavailable' ? FLAG_OFF_REASON : undefined,
  };
}

export function buildNavigation(input: {
  can: (action: Action) => boolean;
  flag: (flag: FeatureFlagKey) => boolean;
  currentPrimaryId: string | null;
}): NavEntry[] {
  return visibleNavigation(input.can, input.flag).map((item) =>
    toEntry(item, input.currentPrimaryId),
  );
}

export interface NavTreeGroup {
  id: string;
  label: string;
  entries: NavEntry[];
}

export interface NavTreeSection {
  id: string;
  /** null = top-level group rendered without a header. */
  label: string | null;
  entries: NavEntry[];
  groups: NavTreeGroup[];
}

/**
 * The collapsible section tree for the sidebar and phone menu. Same items, order and
 * availability rules as buildNavigation; only the grouping differs.
 */
export function buildNavigationTree(input: {
  can: (action: Action) => boolean;
  flag: (flag: FeatureFlagKey) => boolean;
  currentPrimaryId: string | null;
}): NavTreeSection[] {
  return navigationTree(input.can, input.flag).map((section) => ({
    id: section.id,
    label: section.label,
    entries: section.items.map((item) => toEntry(item, input.currentPrimaryId)),
    groups: section.groups.map((group) => ({
      id: group.id,
      label: group.label,
      entries: group.items.map((item) => toEntry(item, input.currentPrimaryId)),
    })),
  }));
}

/**
 * Phone bottom bar: at most five destinations. Registry entries flagged for mobile come first; if
 * the role hides some of them, the next primary routes fill the gap. Everything else is in the
 * menu sheet, so no area is unreachable on a phone.
 */
export function bottomNavEntries(entries: readonly NavEntry[], max = 5): NavEntry[] {
  const mobile = entries.filter((e) => e.mobile);
  const rest = entries.filter((e) => !e.mobile);
  const chosen = [...mobile, ...rest].slice(0, max);
  return entries.filter((e) => chosen.includes(e));
}
