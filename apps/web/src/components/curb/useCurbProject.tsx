'use client';

// Curb project state: the detail query, the readiness query, and `run(command, payload)` which
// sends a typed command with the project's revision and drives the shared autosave states
// (saved / unsaved / saving / offline / conflict / error). A network failure keeps the same
// Idempotency-Key so a retry can never double-apply (ADD-014 command/receipt protocol); a stale
// revision (409) moves to `conflict` and reloads the server copy instead of overwriting it.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { isApiError, newIdempotencyKey } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { curbEndpoints, type CurbDetail, type CurbEndpoints, type CurbPayload, type CurbTypedCommand } from './curbApi';
import { autosaveReducer, type AutosaveState } from './model';

interface CurbProjectContextValue {
  projectId: string;
  detail: CurbDetail | undefined;
  detailQuery: ReturnType<typeof useQuery<CurbDetail>>;
  readiness: Awaited<ReturnType<CurbEndpoints['readiness']>> | undefined;
  curb: CurbEndpoints;
  save: AutosaveState;
  lastError: unknown;
  markEdited: () => void;
  run: <K extends CurbTypedCommand>(type: K, payload: CurbPayload<K>) => Promise<boolean>;
  retry: () => Promise<boolean>;
  reload: () => void;
}

const Ctx = createContext<CurbProjectContextValue | null>(null);

export function useCurbEndpoints(): CurbEndpoints {
  const { api } = useApi();
  return useMemo(() => curbEndpoints(api), [api]);
}

export function curbKeys(orgId: string, projectId: string) {
  return {
    detail: orgKey(orgId, 'curb', projectId, 'detail'),
    readiness: orgKey(orgId, 'curb', projectId, 'readiness'),
    capture: orgKey(orgId, 'curb', projectId, 'capture'),
    photos: orgKey(orgId, 'curb', projectId, 'photos'),
    estimates: orgKey(orgId, 'curb', projectId, 'estimates'),
  };
}

export function CurbProjectProvider({ projectId, children }: { projectId: string; children: ReactNode }) {
  const curb = useCurbEndpoints();
  const session = useSession();
  const qc = useQueryClient();
  const keys = curbKeys(session.orgId, projectId);
  const detailQuery = useQuery({ queryKey: keys.detail, queryFn: () => curb.detail(projectId) });
  const readinessQuery = useQuery({ queryKey: keys.readiness, queryFn: () => curb.readiness(projectId), enabled: detailQuery.isSuccess });
  const [save, dispatch] = useReducer(autosaveReducer, 'saved' as AutosaveState);
  const pending = useRef<{ type: CurbTypedCommand; payload: unknown; key: string } | null>(null);
  const [lastError, setLastError] = useState<unknown>(null);

  const mutation = useMutation({
    mutationFn: async (input: { type: CurbTypedCommand; payload: unknown; key: string }) => {
      const revision = qc.getQueryData<CurbDetail>(keys.detail)?.project.revision ?? detailQuery.data?.project.revision ?? 0;
      return curb.command(projectId, input.type, revision, input.payload as never, input.key);
    },
  });

  const send = useCallback(
    async (input: { type: CurbTypedCommand; payload: unknown; key: string }): Promise<boolean> => {
      pending.current = input;
      dispatch('save_start');
      try {
        const res = await mutation.mutateAsync(input);
        qc.setQueryData(keys.detail, res.detail);
        void qc.invalidateQueries({ queryKey: keys.readiness });
        void qc.invalidateQueries({ queryKey: keys.capture });
        void qc.invalidateQueries({ queryKey: keys.estimates });
        pending.current = null;
        setLastError(null);
        dispatch('save_ok');
        return true;
      } catch (error) {
        setLastError(error);
        if (isApiError(error) && (error.is('revision_conflict') || error.is('precondition_failed') || error.status === 409)) {
          pending.current = null;
          dispatch('save_conflict');
          void qc.invalidateQueries({ queryKey: keys.detail });
        } else if (isApiError(error) && error.kind === 'network') {
          dispatch('save_offline');
        } else {
          pending.current = null;
          dispatch('save_error');
        }
        return false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mutation.mutateAsync, qc, projectId, session.orgId],
  );

  const value: CurbProjectContextValue = {
    projectId,
    detail: detailQuery.data,
    detailQuery,
    readiness: readinessQuery.data,
    curb,
    save,
    lastError,
    markEdited: () => dispatch('edit'),
    run: (type, payload) => send({ type, payload, key: newIdempotencyKey() }),
    retry: () => (pending.current ? send(pending.current) : Promise.resolve(true)),
    reload: () => {
      dispatch('reload');
      void qc.invalidateQueries({ queryKey: keys.detail });
      void qc.invalidateQueries({ queryKey: keys.readiness });
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurbProject(): CurbProjectContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCurbProject must be used inside <CurbProjectProvider>.');
  return ctx;
}
