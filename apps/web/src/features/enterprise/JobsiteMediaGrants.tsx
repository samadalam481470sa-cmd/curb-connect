'use client';

import { JobsiteMediaGrant, MemberListSchema } from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const GrantResponse = z.object({ grant: JobsiteMediaGrant.nullable() });

export function JobsiteMediaGrants({ path, projectId }: { path: string; projectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const [memberId, setMemberId] = useState('');
  const members = useInfiniteQuery({
    queryKey: orgKey(session.orgId, 'enterprise', 'jobsite-media-members'),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get('/v1/team/members', {
        schema: MemberListSchema,
        query: { status: 'active', limit: 100, cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const options =
    members.data?.pages.flatMap(({ items }) =>
      items.filter(({ role }) => role === 'crew_manager' || role === 'reviewer'),
    ) ?? [];
  return (
    <details className="enterprise-panel">
      <summary>Project media access</summary>
      <div className="enterprise-form">
        {members.isPending && <p role="status">Loading team members…</p>}
        {members.isError && <p role="alert">{errorHint(members.error)}</p>}
        {members.isSuccess && (
          <label>
            Field supervisor or reviewer
            <select value={memberId} onChange={(event) => setMemberId(event.target.value)}>
              <option value="">Choose a team member</option>
              {options.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {members.hasNextPage && (
          <button
            type="button"
            disabled={members.isFetchingNextPage}
            onClick={() => void members.fetchNextPage()}
          >
            Load more team members
          </button>
        )}
        {memberId && (
          <GrantForm
            key={memberId}
            path={path + '/grants/' + memberId}
            projectId={projectId}
            memberId={memberId}
          />
        )}
      </div>
    </details>
  );
}

function GrantForm({
  path,
  projectId,
  memberId,
}: {
  path: string;
  projectId: string;
  memberId: string;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = orgKey(session.orgId, 'enterprise', 'jobsite-media', projectId, 'grant', memberId);
  const current = useQuery({
    queryKey: key,
    queryFn: () => api.get(path, { schema: GrantResponse }),
  });
  const [reason, setReason] = useState('');
  const request = useRef<{ signature: string; id: string } | null>(null);
  const save = useMutation({
    mutationFn: ({ active, revision }: { active: boolean; revision: number }) => {
      const signature = JSON.stringify({ active, revision, reason: reason.trim() });
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      return api.put(
        path,
        {
          active,
          reason: reason.trim(),
          clientRequestId: request.current.id,
        },
        { ifMatch: revision, schema: JobsiteMediaGrant },
      );
    },
    onSuccess: (grant) => {
      client.setQueryData(key, { grant });
      setReason('');
      request.current = null;
    },
    onError: (error) => {
      if (isApiError(error) && error.is('precondition_failed')) void current.refetch();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (save.isPending || !current.data || reason.trim().length < 3) return;
    const grant = current.data.grant;
    save.mutate({ active: !grant?.active, revision: grant?.revision ?? 0 });
  }

  if (current.isPending) return <p role="status">Loading project grant…</p>;
  if (current.isError || !current.data)
    return (
      <button type="button" onClick={() => void current.refetch()}>
        Retry loading project grant
      </button>
    );

  const grant = current.data.grant;
  return (
    <form className="enterprise-form" aria-label="Project media grant" onSubmit={submit}>
      <p role="status">{grant?.active ? 'Access granted' : 'Access off'}</p>
      {grant && (
        <p>
          Revision {grant.revision} · {grant.reason}
        </p>
      )}
      <label>
        Reason for access change
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          required
          minLength={3}
          maxLength={1000}
          disabled={save.isPending}
        />
      </label>
      {save.isError && <p role="alert">{errorHint(save.error)}</p>}
      <button type="submit" disabled={save.isPending || reason.trim().length < 3}>
        {save.isPending
          ? 'Saving access…'
          : grant?.active
            ? 'Revoke project media access'
            : 'Grant project media access'}
      </button>
    </form>
  );
}
