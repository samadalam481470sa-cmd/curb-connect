'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useApi, useSession, orgKey } from '../../lib/session';
import { ProjectRecords } from './schemas';
import { CO_TRANSITIONS, RFI_TRANSITIONS, type RFI, type ChangeOrder, type COStatus, type RFIStatus } from './types';

export function useProjectControls(projectId: string, enabled: boolean) {
  const { api } = useApi();
  const session = useSession();
  const key = [...orgKey(session.orgId, 'enterprise'), 'records', projectId];
  const recordsQuery = useQuery({
    queryKey: key,
    queryFn: () => api.get('/v1/enterprise/projects/' + encodeURIComponent(projectId) + '/records', { schema: ProjectRecords }),
    enabled: enabled && !!projectId,
  });

  const updateRFIStatus = useCallback(async (rfi: RFI, status: RFIStatus, officialResponse?: string) => {
    if (!session.can('job:write')) throw new Error('You do not have permission to modify RFIs.');
    if (!RFI_TRANSITIONS[rfi.status].includes(status)) throw new Error('Invalid RFI transition.');
    if (status !== 'open' && !session.can('review_task:decide')) {
      throw new Error('Only authorized reviewers can answer or close RFIs.');
    }
    if ((status === 'answered' || (rfi.status === 'open' && status === 'closed')) && !officialResponse?.trim()) {
      throw new Error('An official response is required.');
    }
    const body = { status, ...(officialResponse?.trim() ? { officialResponse: officialResponse.trim() } : {}) };
    await api.patch('/v1/enterprise/rfis/' + encodeURIComponent(rfi.id) + '/status', body,
      { ifMatch: rfi.revision });
    await recordsQuery.refetch();
  }, [api, recordsQuery, session]);

  const updateCOStatus = useCallback(async (changeOrder: ChangeOrder, status: COStatus) => {
    if (!session.can('job:write')) throw new Error('You do not have permission to modify change orders.');
    if (!CO_TRANSITIONS[changeOrder.status].includes(status)) throw new Error('Invalid change order transition.');
    if (status === 'approved' && !session.can('org:settings_update')) {
      throw new Error('Only the company owner or administrator can approve a change order.');
    }
    await api.patch('/v1/enterprise/change-orders/' + encodeURIComponent(changeOrder.id) + '/status',
      { status }, { ifMatch: changeOrder.revision });
    await recordsQuery.refetch();
  }, [api, recordsQuery, session]);

  return {
    recordsQuery,
    rfis: (recordsQuery.data?.rfis ?? []).filter((r): r is RFI => Object.hasOwn(RFI_TRANSITIONS, r.status)),
    changeOrders: (recordsQuery.data?.changeOrders ?? []).filter((r): r is ChangeOrder => Object.hasOwn(CO_TRANSITIONS, r.status)),
    loading: recordsQuery.isPending || recordsQuery.isFetching,
    error: recordsQuery.error,
    updateRFIStatus,
    updateCOStatus,
    refresh: recordsQuery.refetch,
  };
}
