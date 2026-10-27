'use client';

import { useQuery } from '@tanstack/react-query';
import { resolveDisplay, useDisplayPreferences } from './preferences';
import { orgKey, useApi, useSession } from './session';

/** The active organization's profile (currency, timezone, measurement default). */
export function useOrganization() {
  const { endpoints } = useApi();
  const { orgId } = useSession();
  return useQuery({
    queryKey: orgKey(orgId, 'organization'),
    queryFn: () => endpoints.organization(orgId),
    enabled: Boolean(orgId),
    staleTime: 5 * 60_000,
  });
}

/**
 * Effective display settings: personal device preference, else the organization default, else
 * the browser. Display only (PLT-019): stored values are never converted.
 */
export function useDisplay() {
  const [prefs] = useDisplayPreferences();
  const org = useOrganization();
  const resolved = resolveDisplay(prefs, org.data);
  return { ...resolved, timeZone: org.data?.timezone, currency: org.data?.currency };
}
