'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { API_PATHS } from '../lib/endpoints';
import { orgKey, useApi, useSession } from '../lib/session';
import {
  ChangeOrderListSchema,
  RFIListSchema,
  mayTransitionCO,
  mayTransitionRFI,
  type COStatus,
  type RFIStatus,
} from '../types/enterprise';

/**
 * Reads always use the active workspace's cookie-backed API client. No sample/fake records.
 * Future server endpoints must enforce the same transitions and actor authorization.
 */
export function useProjectControls(projectId: string) {
  const { api } = useApi();
  const { orgId } = useSession();
  const queryClient = useQueryClient();
  const queryKey = orgKey(orgId, 'enterprise-project-controls', projectId);

  const controls = useQuery({
    queryKey,
    enabled: Boolean(projectId && orgId),
    queryFn: async ({ signal }) => {
      const [rfis, changeOrders] = await Promise.all([
        api.get(API_PATHS.projectRfis(projectId), { schema: RFIListSchema, signal }),
        api.get(API_PATHS.projectChangeOrders(projectId), {
          schema: ChangeOrderListSchema,
          signal,
        }),
      ]);
      return { rfis, changeOrders };
    },
    retry: false,
  });

  const updateRfi = useMutation({
    mutationFn: async (input: { id: string; status: RFIStatus; response?: string }) => {
      const current = controls.data?.rfis.find((rfi) => rfi.id === input.id);
      if (!current || !mayTransitionRFI(current.status, input.status))
        throw new Error('This RFI transition is not allowed. Refresh the project and try again.');
      if (input.status === 'answered' && !input.response?.trim())
        throw new Error('Enter an official response before marking an RFI answered.');
      await api.patch(API_PATHS.projectRfi(projectId, input.id), {
        status: input.status,
        ...(input.status === 'answered' ? { official_response: input.response?.trim() } : {}),
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const updateCo = useMutation({
    mutationFn: async (input: { id: string; status: COStatus }) => {
      const current = controls.data?.changeOrders.find((co) => co.id === input.id);
      if (!current || !mayTransitionCO(current.status, input.status))
        throw new Error('This change order transition is not allowed. Refresh the project.');
      await api.patch(API_PATHS.projectChangeOrder(projectId, input.id), {
        status: input.status,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const updateRFIStatus = useCallback(
    (id: string, status: RFIStatus, response?: string) =>
      updateRfi.mutateAsync({ id, status, response }),
    [updateRfi],
  );
  const updateCOStatus = useCallback(
    (id: string, status: COStatus) => updateCo.mutateAsync({ id, status }),
    [updateCo],
  );

  return {
    rfis: controls.data?.rfis ?? [],
    changeOrders: controls.data?.changeOrders ?? [],
    loading: controls.isPending,
    error: controls.error,
    actionError: updateRfi.error ?? updateCo.error,
    updateRFIStatus,
    updateCOStatus,
    rfiPendingId: updateRfi.isPending ? (updateRfi.variables?.id ?? null) : null,
    coPendingId: updateCo.isPending ? (updateCo.variables?.id ?? null) : null,
    refresh: () => controls.refetch(),
  };
}
