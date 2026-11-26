'use client';

import { JobsiteMediaPage, type JobsiteMediaAsset } from '@fieldline/contracts';
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

export function EnterpriseJobsiteMedia({ projectId }: { projectId: string }) {
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
              maxVideoDurationMs={latest.maxVideoDurationMs}
              onUploaded={(name) => {
                setNotice(name + ' uploaded for scanning.');
                void client.invalidateQueries({ queryKey: key });
              }}
            />
          )}
          {latest.canManageGrants && <JobsiteMediaGrants path={path} projectId={projectId} />}
          <JobsiteEvidencePanel path={path} />
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
          <section className="enterprise-panel" aria-label="Project photos">
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
                    {mediaDetails(photo)}
                    {photo.scanState === 'clean' && (
                      <>
                        <JobsitePhotoAnnotations
                          path={path + '/' + photo.id + '/annotations'}
                          filename={photo.filename}
                          canEdit={session.can('enterprise_media:annotate')}
                        />
                        <a href={path + '/' + photo.id + '/original'}>Download original</a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
          {(latest.maxVideoDurationMs !== null || videos.length > 0) && (
            <section className="enterprise-panel" aria-label="Project videos">
              <h2>Project videos</h2>
              {videos.length === 0 && (
                <p>
                  {search ? 'No videos match your search.' : 'This project has no uploaded videos.'}
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
        </>
      )}
    </main>
  );
}
