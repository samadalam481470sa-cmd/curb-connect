'use client';

import { JobsitePhotoMime, JobsitePhotoPage } from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { JobsiteMediaGrants } from './JobsiteMediaGrants';
import { uploadJobsitePhoto, type JobsitePhotoDraft } from './jobsitePhotoUpload';

const scanLabels = {
  pending: 'Awaiting scan',
  clean: 'Available',
  infected: 'Quarantined',
  unsupported: 'Invalid image',
  scan_failed: 'Scan unavailable',
};

const fileSize = (bytes: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(bytes / 1024 / 1024) +
  ' MiB';

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
            <PhotoUpload
              path={path}
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

function PhotoUpload({
  path,
  maxBytes,
  onUploaded,
}: {
  path: string;
  maxBytes: number;
  onUploaded: (filename: string) => void;
}) {
  const { api } = useApi();
  const field = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<JobsitePhotoDraft | null>(null);
  const [validation, setValidation] = useState('');
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const upload = useMutation({
    mutationFn: (input: JobsitePhotoDraft) =>
      uploadJobsitePhoto(api, path, input, (received, total) => setProgress({ received, total })),
    onSuccess: (photo) => {
      setDraft(null);
      setProgress(null);
      if (field.current) field.current.value = '';
      onUploaded(photo.filename);
    },
  });

  function pick(file: File | undefined) {
    upload.reset();
    setDraft(null);
    setProgress(null);
    setValidation('');
    if (!file) return;
    if (!JobsitePhotoMime.safeParse(file.type).success) {
      setValidation('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size === 0 || file.size > maxBytes) {
      setValidation('Choose a photo smaller than ' + fileSize(maxBytes) + '.');
      return;
    }
    if (file.name.length > 120) {
      setValidation('Use a photo filename of 120 characters or fewer.');
      return;
    }
    setDraft({
      file,
      capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
      localCaptureId: crypto.randomUUID(),
      finalizeRequestId: crypto.randomUUID(),
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || upload.isPending) return;
    upload.mutate(draft);
  }

  return (
    <section className="enterprise-panel">
      <h2>Upload a jobsite photo</h2>
      <form className="enterprise-form" aria-label="Upload jobsite photo" onSubmit={submit}>
        <label>
          Jobsite photo
          <input
            ref={field}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={upload.isPending}
            onChange={(event) => pick(event.target.files?.[0])}
          />
        </label>
        <p>
          JPEG, PNG, or WebP up to {fileSize(maxBytes)}. Originals are available after scanning.
        </p>
        {validation && (
          <p className="enterprise-error" role="alert">
            {validation}
          </p>
        )}
        {upload.isError && (
          <p className="enterprise-error" role="alert">
            {errorHint(upload.error)}{' '}
            {isApiError(upload.error) && 'Support reference ' + upload.error.problem.correlationId}
          </p>
        )}
        {progress && (
          <p role="status">
            {progress.received} of {progress.total} parts uploaded
          </p>
        )}
        <button type="submit" disabled={!draft || upload.isPending}>
          {upload.isPending ? 'Uploading…' : upload.isError ? 'Retry upload' : 'Upload photo'}
        </button>
      </form>
    </section>
  );
}
