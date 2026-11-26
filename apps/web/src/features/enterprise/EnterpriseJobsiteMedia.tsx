'use client';

import { JobsiteMediaPage, type JobsiteMediaAsset } from '@fieldline/contracts';
import { Skeleton } from '@fieldline/ui';
import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { JobsiteMediaGrants } from './JobsiteMediaGrants';
import { JobsiteEvidencePanel } from './JobsiteEvidencePanel';
import { JobsiteCaption } from './JobsiteMediaCaption';
import { JobsiteMediaTaskLinks } from './JobsiteMediaTaskLinks';
import { JobsitePhotoAnnotations } from './JobsitePhotoAnnotations';
import { JobsiteCustomerPhotoPreview } from './JobsiteCustomerPhotoPreview';
import { JobsiteHomeownerSharesPanel } from './JobsiteHomeownerSharesPanel';
import { JobsiteMediaExports } from './JobsiteMediaExports';
import { JobsiteMediaActivityPanel } from './JobsiteMediaActivityPanel';
import { JobsitePhotoIntake } from './JobsitePhotoIntake';

const scanLabels = {
  pending: 'Awaiting scan',
  clean: 'Available',
  infected: 'Quarantined',
  unsupported: 'Invalid image',
  scan_failed: 'Scan unavailable',
};
const videoLabels = {
  queued: 'Awaiting video processing',
  processing: 'Processing video',
  ready: 'Available',
  rejected: 'Video rejected',
  failed: 'Video processing unavailable',
};

export function EnterpriseJobsiteMedia({
  projectId,
  initialEvidenceTaskId,
}: {
  projectId: string;
  initialEvidenceTaskId?: string;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const path = '/v1/enterprise/projects/' + projectId + '/media';
  const key = orgKey(session.orgId, 'enterprise', 'jobsite-media', projectId);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const library = useInfiniteQuery({
    queryKey: [...key, 'library', search],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, { schema: JobsiteMediaPage, query: { cursor: pageParam, search } }),
    getNextPageParam: (page) => page.nextCursor,
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.items.some(
          ({ scanState, videoState }) =>
            scanState === 'pending' || videoState === 'queued' || videoState === 'processing',
        ),
      )
        ? 4000
        : false,
  });
  const denied = isApiError(library.error) && [401, 403, 404].includes(library.error.status);
  const latest = denied ? undefined : library.data?.pages[0];
  const items = library.data?.pages.flatMap((page) => page.items) ?? [];
  const photos = items.filter(({ videoState }) => videoState === null);
  const videos = items.filter(({ videoState }) => videoState !== null);
  const [notice, setNotice] = useState('');
  const membership = session.me.memberships.find(({ orgId }) => orgId === session.orgId);
  const companyName = membership?.orgDisplayName;
  const hasVideos = (latest?.maxVideoDurationMs ?? null) !== null || videos.length > 0;

  function findMedia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
  }

  function mediaDetails(item: z.infer<typeof JobsiteMediaAsset>) {
    const canUpdate =
      latest?.canUpload === true &&
      item.scanState !== 'infected' &&
      item.scanState !== 'unsupported';
    return (
      <>
        <JobsiteCaption
          path={path + '/' + item.id + '/caption'}
          initial={item.caption}
          canEdit={canUpdate && item.uploaderUserId === session.me.user.id}
          onSaved={() => {
            setNotice('Caption saved.');
            void client.invalidateQueries({ queryKey: key });
          }}
        />
        {session.can('job:read') && (
          <JobsiteMediaTaskLinks projectId={projectId} assetId={item.id} canLink={canUpdate} />
        )}
      </>
    );
  }
  return (
    <main className="enterprise-suite">
      <div className="enterprise-hero">
        <nav aria-label="Project media breadcrumb">
          <Link className="enterprise-back" href="/enterprise/field">
            ← Field Execution
          </Link>
        </nav>
        <h1>Jobsite media</h1>
        {latest && <p>{[companyName, latest.projectName].filter(Boolean).join(' · ')}</p>}
      </div>
      {library.isPending && <Skeleton variant="card" label="Loading jobsite media" />}
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
        <div className="enterprise-jobsite-layout">
          <div className="enterprise-jobsite-workspace">
            <nav className="enterprise-media-toolbar" aria-label="Project media actions">
              {latest.canUpload && (
                <a href="#jobsite-capture" className="enterprise-media-capture-link">
                  Capture media
                </a>
              )}
              <a href="#jobsite-photos">Photos</a>
              {hasVideos && <a href="#jobsite-videos">Videos</a>}
              {session.can('review_task:read') && (
                <Link href="/enterprise/media/review">Media review</Link>
              )}
              {membership?.role === 'crew_manager' && latest.canUpload && (
                <Link href="/portal/contractor/jobs">Assigned contractor jobs</Link>
              )}
            </nav>
            {latest.canUpload && (
              <div id="jobsite-capture">
                <JobsitePhotoIntake
                  key={session.orgId + ':' + session.me.user.id + ':' + projectId}
                  path={path}
                  projectId={projectId}
                  maxBytes={latest.maxBytes}
                  maxVideoDurationMs={latest.maxVideoDurationMs}
                  onUploaded={(name) => {
                    setNotice(name + ' uploaded for scanning.');
                    void client.invalidateQueries({ queryKey: key });
                    void client.invalidateQueries({
                      queryKey: orgKey(session.orgId, 'enterprise', 'jobsite-media-activity', path),
                    });
                  }}
                />
              </div>
            )}
            {latest.canManageGrants && <JobsiteMediaGrants path={path} projectId={projectId} />}
            <JobsiteEvidencePanel
              key={initialEvidenceTaskId ?? path}
              path={path}
              initialTaskId={initialEvidenceTaskId}
            />
            {session.can('enterprise_media:share_customer_media') && (
              <JobsiteHomeownerSharesPanel path={path} />
            )}
            {session.can('export:create') && <JobsiteMediaExports path={path} media={items} />}
            {notice && <p role="status">{notice}</p>}
            <form
              className="enterprise-form enterprise-panel"
              role="search"
              aria-label="Search project media"
              onSubmit={findMedia}
            >
              <label>
                Search captions or tags
                <input
                  type="search"
                  value={searchInput}
                  maxLength={120}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </label>
              <button type="submit">Search media</button>
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput('');
                    setSearch('');
                  }}
                >
                  Clear media search
                </button>
              )}
              {library.isPlaceholderData && <p role="status">Loading matching media…</p>}
            </form>
            <section id="jobsite-photos" className="enterprise-panel" aria-label="Project photos">
              <h2>Project photos</h2>
              {photos.length === 0 && (
                <p>
                  {search ? 'No photos match your search.' : 'This project has no uploaded photos.'}
                </p>
              )}
              {photos.length > 0 && (
                <ul className="enterprise-change-history">
                  {photos.map((photo) => (
                    <li key={photo.id}>
                      <strong>{photo.filename}</strong>
                      <time dateTime={photo.capturedAt}>
                        {new Date(photo.capturedAt).toLocaleString()}
                      </time>
                      <span>{scanLabels[photo.scanState]}</span>
                      <span>Revision {photo.revision}</span>
                      {mediaDetails(photo)}
                      {photo.scanState === 'clean' && (
                        <>
                          <JobsitePhotoAnnotations
                            path={path + '/' + photo.id + '/annotations'}
                            filename={photo.filename}
                            canEdit={session.can('enterprise_media:annotate')}
                          />
                          {session.can('enterprise_media:approve_customer_media') && (
                            <JobsiteCustomerPhotoPreview
                              path={path + '/' + photo.id + '/customer-preview'}
                            />
                          )}
                          <a href={path + '/' + photo.id + '/original'}>Download original</a>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {hasVideos && (
              <section id="jobsite-videos" className="enterprise-panel" aria-label="Project videos">
                <h2>Project videos</h2>
                {videos.length === 0 && (
                  <p>
                    {search
                      ? 'No videos match your search.'
                      : 'This project has no uploaded videos.'}
                  </p>
                )}
                {videos.length > 0 && (
                  <ul className="enterprise-change-history">
                    {videos.map((video) => (
                      <li key={video.id}>
                        <strong>{video.filename}</strong>
                        <time dateTime={video.capturedAt}>
                          {new Date(video.capturedAt).toLocaleString()}
                        </time>
                        <span>
                          {video.scanState === 'clean' && video.videoState
                            ? videoLabels[video.videoState]
                            : scanLabels[video.scanState]}
                        </span>
                        <span>Revision {video.revision}</span>
                        {mediaDetails(video)}
                        {video.videoState === 'ready' && video.playback && (
                          <>
                            <video
                              aria-label={'Playback for ' + video.filename}
                              className="enterprise-jobsite-camera"
                              preload="none"
                              controls
                              playsInline
                              src={path + '/' + video.id + '/playback'}
                            />
                            <a href={path + '/' + video.id + '/original'}>Download original</a>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {library.hasNextPage && (
              <button
                type="button"
                disabled={library.isFetchingNextPage}
                onClick={() => void library.fetchNextPage()}
              >
                Load more project media
              </button>
            )}
          </div>
          <div className="enterprise-jobsite-detail">
            <JobsiteMediaActivityPanel path={path} />
          </div>
          {latest.canUpload && (
            <div className="enterprise-mobile-capture">
              <a href="#jobsite-capture">Capture media</a>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
