// PLT-011: navigation derived from the route registry, the member's effective permissions and the
// organization's feature flags. Routes the role cannot open are omitted; routes whose flag is off
// stay visible but unavailable with a reason. Roof Measurements and Curb Cutting keep their
// registry positions (adjacent, directly after Home) on every breakpoint (PLT-011 A).
import {
  visibleNavigation,
  type Action,
  type FeatureFlagKey,
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

export function buildNavigation(input: {
  can: (action: Action) => boolean;
  flag: (flag: FeatureFlagKey) => boolean;
  currentPrimaryId: string | null;
}): NavEntry[] {
  return visibleNavigation(input.can, input.flag).map(({ route, availability }) => {
    const r = route as RouteDefinition;
    return {
      id: r.id,
      label: r.label,
      href: r.path,
      icon: r.icon,
      current: r.id === input.currentPrimaryId,
      mobile: Boolean(r.mobileBottomNav),
      unavailableReason: availability === 'unavailable' ? FLAG_OFF_REASON : undefined,
    };
  });
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
