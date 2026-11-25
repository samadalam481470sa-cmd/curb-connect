'use client';

import { JobsitePhotoPage } from '@fieldline/contracts';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { JobsiteMediaGrants } from './JobsiteMediaGrants';
import { JobsitePhotoIntake } from './JobsitePhotoIntake';

const scanLabels = {
  pending: 'Awaiting scan',
  clean: 'Available',
  infected: 'Quarantined',
  unsupported: 'Invalid image',
  scan_failed: 'Scan unavailable',
};

export function EnterpriseJobsiteMedia({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const path = '/v1/enterprise/projects/' + projectId + '/media';
  const key = orgKey(session.orgId, 'enterprise', 'jobsite-media', projectId);
  const library = useInfiniteQuery({
    queryKey: key,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, { schema: JobsitePhotoPage, query: { cursor: pageParam } }),
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.items.some(({ scanState }) => scanState === 'pending'),
      )
        ? 4000
        : false,
  });
  const denied = isApiError(library.error) && [401, 403, 404].includes(library.error.status);
  const latest = denied ? undefined : library.data?.pages[0];
  const photos = library.data?.pages.flatMap((page) => page.items) ?? [];
  const [notice, setNotice] = useState('');
  return (
    <main className="enterprise-suite">
      <div className="enterprise-hero">
        <Link className="enterprise-back" href="/enterprise/field">
          ← Field Execution
        </Link>
        <h1>Jobsite media</h1>
        {latest && <p>{latest.projectName}</p>}
      </div>
      {library.isPending && (
        <p className="enterprise-panel" role="status">
          Loading jobsite media…
        </p>
      )}
      {library.isError && (
        <section className="enterprise-panel">
          <p role="alert">
            {isApiError(library.error) && library.error.is('not_found')
              ? 'This project’s media is unavailable.'
              : errorHint(library.error)}
          </p>
          {isApiError(library.error) && (
            <p>Support reference {library.error.problem.correlationId}</p>
          )}
          <button type="button" onClick={() => void library.refetch()}>
            Retry loading media
          </button>
        </section>
      )}
      {latest && (
        <>
          {latest.canUpload && (
            <JobsitePhotoIntake
              key={session.orgId + ':' + session.me.user.id + ':' + projectId}
              path={path}
              projectId={projectId}
              maxBytes={latest.maxBytes}
              onUploaded={(name) => {
                setNotice(name + ' uploaded for scanning.');
                void client.invalidateQueries({ queryKey: key });
              }}
            />
          )}
          {latest.canManageGrants && <JobsiteMediaGrants path={path} projectId={projectId} />}
          {notice && <p role="status">{notice}</p>}
          <section className="enterprise-panel" aria-label="Project photos">
            <h2>Project photos</h2>
            {photos.length === 0 && <p>This project has no uploaded photos.</p>}
            {photos.length > 0 && (
              <ul className="enterprise-change-history">
                {photos.map((photo) => (
                  <li key={photo.id}>
                    <strong>{photo.filename}</strong>
                    <time dateTime={photo.capturedAt}>
                      {new Date(photo.capturedAt).toLocaleString()}
                    </time>
                    <span>{scanLabels[photo.scanState]}</span>
                    {photo.scanState === 'clean' && (
                      <a href={path + '/' + photo.id + '/original'}>Download original</a>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {library.hasNextPage && (
              <button
                type="button"
                disabled={library.isFetchingNextPage}
                onClick={() => void library.fetchNextPage()}
              >
                Load more photos
              </button>
            )}
          </section>
        </>
      )}
    </main>
  );
}
