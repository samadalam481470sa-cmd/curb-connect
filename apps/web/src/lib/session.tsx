'use client';

// Client-side session state. The API is authoritative for every permission (PLT-011 R, PLT-015 R):
// /v1/me returns the effective permissions and flags for the active workspace, and the UI uses
// them only to hide or explain actions. All tenant queries are keyed by org id, and switching
// workspace clears the whole cache so two companies' records are never mixed (PLT-004 S).
import {
  explainDenied,
  type Action,
  type FeatureFlagKey,
  type MeResponse,
} from '@fieldline/contracts';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { createApiClient, isApiError, type ApiClient, type AuthFailureReason } from './api';
import { createEndpoints, type Endpoints } from './endpoints';
import { isFlagEnabled } from './routing';

interface ApiContextValue {
  api: ApiClient;
  endpoints: Endpoints;
}

const ApiContext = createContext<ApiContextValue | null>(null);

export const ME_QUERY_KEY = ['me'] as const;

/** Query keys for tenant data always start with the org id. */
export function orgKey(orgId: string | null | undefined, ...rest: unknown[]): unknown[] {
  return ['org', orgId ?? 'none', ...rest];
}

export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (failureCount, error) =>
          failureCount < 2 && (!isApiError(error) || (error.retryable && error.kind !== 'problem')),
      },
      mutations: { retry: false },
    },
  });
}

export function accessPath(reason: AuthFailureReason, returnTo?: string): string {
  const params = new URLSearchParams();
  if (returnTo) params.set('returnTo', returnTo);
  if (reason === 'workspace_required') return `/select-workspace?${params.toString()}`;
  // Never signed in (or signed out elsewhere): go straight to sign-in. An expired session or a
  // revoked membership lands on the recovery page first (PLT-011 S).
  if (reason === 'signed_out') return `/sign-in?${params.toString()}`;
  params.set('reason', reason);
  return `/access?${params.toString()}`;
}

export function AppProviders({
  children,
  queryClient: provided,
  api: providedApi,
}: {
  children: ReactNode;
  queryClient?: QueryClient;
  api?: ApiClient;
}) {
  const router = useRouter();
  const [queryClient] = useState(() => provided ?? makeQueryClient());
  const [value] = useState<ApiContextValue>(() => {
    const api =
      providedApi ??
      createApiClient({
        onAuthFailure: (reason) => {
          // Drop every cached tenant response before leaving (PLT-011 S).
          queryClient.clear();
          const here = `${window.location.pathname}${window.location.search}`;
          if (/^\/(access|sign-in)(\/|$)/.test(window.location.pathname)) return;
          router.replace(accessPath(reason, here));
        },
      });
    return { api, endpoints: createEndpoints(api) };
  });
  return (
    <QueryClientProvider client={queryClient}>
      <ApiContext.Provider value={value}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
}

export function useApi(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApi must be used inside <AppProviders>.');
  return ctx;
}

export function useMe() {
  const { endpoints } = useApi();
  return useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: () => endpoints.me(),
    staleTime: 60_000,
    retry: false,
  });
}

export interface PermissionCheck {
  allowed: boolean;
  /** Plain-language reason when not allowed (PLT-015 A). */
  reason?: string;
}

export function checkPermission(me: MeResponse | undefined, action: Action): PermissionCheck {
  if (!me || !me.activeRole) {
    return { allowed: false, reason: 'Choose a workspace to continue.' };
  }
  if (me.permissions.includes(action)) return { allowed: true };
  return {
    allowed: false,
    reason: `${explainDenied(me.activeRole, action)} Ask an owner or admin.`,
  };
}

export interface SessionApi {
  me: MeResponse;
  can: (action: Action) => boolean;
  check: (action: Action) => PermissionCheck;
  flag: (flag: FeatureFlagKey) => boolean;
  orgId: string;
  /** Re-reads /v1/me, e.g. after the member's own role changed. */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionApi | null>(null);

export function SessionProvider({ me, children }: { me: MeResponse; children: ReactNode }) {
  const queryClient = useQueryClient();
  const value = useMemo<SessionApi>(
    () => ({
      me,
      orgId: me.activeOrgId ?? '',
      can: (action) => checkPermission(me, action).allowed,
      check: (action) => checkPermission(me, action),
      flag: (flag) => isFlagEnabled(me.flags, flag),
      refresh: () => queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY }),
    }),
    [me, queryClient],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** The signed-in member in the active workspace. Only valid inside the app shell. */
export function useSession(): SessionApi {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside the signed-in app shell.');
  return ctx;
}

/** Switches the active workspace server-side, then drops every cached record of the old one. */
export function useSwitchWorkspace() {
  const { endpoints } = useApi();
  const queryClient = useQueryClient();
  const router = useRouter();
  return async (orgId: string, destination = '/') => {
    const me = await endpoints.switchWorkspace(orgId);
    queryClient.clear();
    queryClient.setQueryData(ME_QUERY_KEY, me);
    router.replace(destination);
  };
}
