'use client';

// React Query wrapper over the offline read store: sync from the server (delta since
// the stored watermark); when the network is gone, render the cached copy instead of
// an error. The cached copy is per-org, so a workspace switch never leaks rows.
import { useQuery } from '@tanstack/react-query';
import { useApi, useSession } from '../session';
import { getReadStore, type SyncedEntity } from './readStore';

export function useSyncedList<T extends { id: string }>(
  entity: SyncedEntity,
  path: string,
  qualifier?: string,
) {
  const session = useSession();
  const { api } = useApi();
  const store = getReadStore();
  return useQuery({
    queryKey: ['synced', session.orgId, entity, qualifier ?? ''],
    queryFn: async (): Promise<T[]> => {
      try {
        return await store.sync<T>(api, { orgId: session.orgId }, entity, path, qualifier);
      } catch {
        const cached = await store.read<T>({ orgId: session.orgId }, entity, qualifier);
        if (cached.length > 0) return cached;
        throw new Error('offline-no-cache');
      }
    },
  });
}
