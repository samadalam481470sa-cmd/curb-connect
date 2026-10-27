// Route lookups on top of the contracts route registry (PLT-011 D). The registry owns paths,
// labels, permissions, flags, breadcrumbs and analytics names; this file only matches a browser
// pathname to a registry entry.
import {
  FEATURE_FLAGS,
  PRIMARY_ROUTES,
  ROUTES,
  breadcrumbs,
  type FeatureFlagKey,
  type RouteDefinition,
  type RouteId,
} from '@fieldline/contracts';

interface CompiledRoute {
  route: RouteDefinition;
  regex: RegExp;
  /** Literal characters; more literal = more specific (/roof/new beats /roof/orders/:id). */
  specificity: number;
}

function compile(route: RouteDefinition): CompiledRoute {
  const pattern = route.path
    .split('/')
    .map((segment) =>
      segment.startsWith(':') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return {
    route,
    regex: new RegExp(`^${pattern === '' ? '/' : pattern}/?$`),
    specificity: route.path.replace(/:[A-Za-z]+/g, '').length,
  };
}

const COMPILED = ROUTES.map(compile).sort((a, b) => b.specificity - a.specificity);

/** Pathnames that are aliases of a registry route (the task's /home is the registry's /). */
const ALIASES: Record<string, string> = { '/home': '/' };

/** Exact registry match, else the deepest primary area that prefixes the path. */
export function matchRoute(pathname: string): RouteDefinition | null {
  const path = ALIASES[pathname] ?? (pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname);
  const exact = COMPILED.find((c) => c.regex.test(path));
  if (exact) return exact.route;
  const area = (PRIMARY_ROUTES as readonly RouteDefinition[])
    .filter((r) => r.path !== '/' && (path === r.path || path.startsWith(`${r.path}/`)))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return area ?? null;
}

/** The primary navigation entry a route belongs to (for aria-current in the sidebar). */
export function primaryAncestor(route: RouteDefinition): RouteDefinition {
  const trail = breadcrumbs(route.id as RouteId);
  return trail[0] ?? route;
}

export function breadcrumbTrail(route: RouteDefinition): { label: string; href?: string }[] {
  const trail = breadcrumbs(route.id as RouteId);
  const items = trail.map((r) => ({
    label: r.label,
    href: r.path.includes(':') ? undefined : r.path,
  }));
  // Home is the root of every trail.
  if (trail[0]?.id !== 'home') items.unshift({ label: 'Home', href: '/' });
  return items;
}

/** Server flags win; a flag the server did not send falls back to its registry default. */
export function isFlagEnabled(
  flags: Partial<Record<string, boolean>>,
  flag: FeatureFlagKey,
): boolean {
  return flags[flag] ?? FEATURE_FLAGS[flag].defaultEnabled;
}

/** Returns a same-origin relative path, or the fallback (prevents open redirects via returnTo). */
export function safeReturnTo(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return fallback;
  if (/^\/(sign-in|access)(\/|\?|$)/.test(value)) return fallback;
  return value;
}
