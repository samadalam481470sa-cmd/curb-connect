'use client';

import { JobsiteMediaPage, JobsitePhotoMime, JobsiteVideoMime } from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { errorHint, isApiError } from '../../lib/api';
import { useOnlineStatus } from '../../lib/offline/online';
import { orgKey, useApi, useSession } from '../../lib/session';
import { JobsitePhotoCamera } from './JobsitePhotoCamera';
import { JobsiteVideoRecorder } from './JobsiteVideoRecorder';
import {
  listJobsiteMediaDrafts,
  readJobsiteMediaDraft,
  removeUploadedJobsiteDraft,
  saveJobsiteMediaDraft,
} from './jobsitePhotoDrafts';
import { uploadJobsiteMedia, type JobsiteMediaDraft } from './jobsitePhotoUpload';

const uploadAccessSchema = JobsiteMediaPage.pick({ canUpload: true, maxVideoDurationMs: true });

const fileSize = (bytes: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(bytes / 1024 / 1024) +
  ' MiB';

function operationError(error: unknown) {
  if (isApiError(error)) return errorHint(error);
  return error instanceof Error ? error.message : 'The file could not be prepared.';
}

export function JobsitePhotoIntake({
  path,
  projectId,
  maxBytes,
  maxVideoDurationMs,
  onUploaded,
  onAccessLost,
}: {
  path: string;
  projectId: string;
  maxBytes: number;
  maxVideoDurationMs: number | null;
  onUploaded: (filename: string) => void;
  onAccessLost?: () => void;
}) {
  const { api } = useApi();
  const session = useSession();
  const online = useOnlineStatus();
  const client = useQueryClient();
  const scope = { orgId: session.orgId, userId: session.me.user.id, projectId };
  const key = orgKey(scope.orgId, 'enterprise', 'jobsite-photo-drafts', scope.userId, projectId);
  const queue = useQuery({
    queryKey: key,
    queryFn: () => listJobsiteMediaDrafts(scope),
    networkMode: 'always',
    refetchOnWindowFocus: 'always',
    retry: false,
  });
  const [selected, setSelected] = useState('');
  const [validation, setValidation] = useState('');
  const [storageNotice, setStorageNotice] = useState('');
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [unsaved, setUnsaved] = useState<JobsiteMediaDraft | null>(null);
  const drafts = queue.data?.drafts ?? [];
  const draft = drafts.find(({ id }) => id === selected) ?? drafts[0];
  const isVideo = draft?.durationMs !== undefined;
  const canUploadDraft = !isVideo || maxVideoDurationMs !== null;
  const itemName = isVideo ? 'video' : 'photo';
  const persist = useMutation({
    mutationFn: (input: JobsiteMediaDraft) => saveJobsiteMediaDraft(scope, input),
    networkMode: 'always',
    onSuccess: (item) => {
      setUnsaved(null);
      setSelected(item.id);
      setStorageNotice(item.filename + ' saved on this device.');
      void queue.refetch();
    },
  });
  const upload = useMutation({
    mutationFn: async (id: string) => {
      const access = await api.get(path, { query: { limit: 1 }, schema: uploadAccessSchema });
      if (!access.canUpload)
        throw new Error('Your current project access does not permit uploads.');
      const queued = await readJobsiteMediaDraft(scope, id);
      if (queued.durationMs !== undefined && access.maxVideoDurationMs === null)
        throw new Error(
          'Private video processing is currently unavailable. The saved clip stays on this device.',
        );
      const media = await uploadJobsiteMedia(api, path, queued, (received, total) =>
        setProgress({ received, total }),
      );
      let cleanupFailed = false;
      try {
        await removeUploadedJobsiteDraft(scope, id);
      } catch {
        cleanupFailed = true;
      }
      return { media, cleanupFailed };
    },
    onSuccess: ({ media, cleanupFailed }) => {
      setProgress(null);
      setStorageNotice(
        cleanupFailed ? 'The server saved the file. Its device copy could not be cleared.' : '',
      );
      void client.invalidateQueries({ queryKey: key });
      onUploaded(media.filename);
    },
    onError: (error) => {
      if (isApiError(error) && [401, 403, 404].includes(error.status)) {
        onAccessLost?.();
        void client.invalidateQueries({
          queryKey: orgKey(session.orgId, 'enterprise', 'jobsite-media', projectId),
        });
      }
    },
  });

  function pick(file: File | undefined, durationMs?: number) {
    if (!file) return;
    upload.reset();
    setProgress(null);
    setValidation('');
    setStorageNotice('');
    if (
      durationMs !== undefined &&
      (!maxVideoDurationMs ||
        durationMs > maxVideoDurationMs ||
        !JobsiteVideoMime.safeParse(file.type).success)
    ) {
      setValidation('Record an MP4 or WebM clip within the current video limit.');
      return;
    }
    if (durationMs === undefined && !JobsitePhotoMime.safeParse(file.type).success) {
      setValidation('Choose a JPEG, PNG, or WebP image.');
      return;
    }
    if (file.size === 0 || file.size > maxBytes) {
      setValidation('Choose a file smaller than ' + fileSize(maxBytes) + '.');
      return;
    }
    if (file.name.length > 120) {
      setValidation('Use a filename of 120 characters or fewer.');
      return;
    }
    if (!globalThis.crypto?.randomUUID) {
      setValidation('Encrypted device storage needs a secure browser connection.');
      return;
    }
    const input = {
      file,
      capturedAt: new Date(file.lastModified || Date.now()).toISOString(),
      localCaptureId: crypto.randomUUID(),
      finalizeRequestId: crypto.randomUUID(),
      ...(durationMs !== undefined && { durationMs }),
    };
    setUnsaved(input);
    persist.mutate(input);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !canUploadDraft || !online || upload.isPending || persist.isPending) return;
    upload.mutate(draft.id);
  }

  const busy = persist.isPending || upload.isPending;
  return (
    <section className="enterprise-panel">
      <h2>{maxVideoDurationMs ? 'Capture jobsite media' : 'Upload a jobsite photo'}</h2>
      <form
        className="enterprise-form"
        aria-label={maxVideoDurationMs ? 'Upload jobsite media' : 'Upload jobsite photo'}
        onSubmit={submit}
      >
        <JobsitePhotoCamera disabled={busy} onPhoto={pick} />
        {maxVideoDurationMs && (
          <JobsiteVideoRecorder
            maxBytes={maxBytes}
            maxDurationMs={maxVideoDurationMs}
            disabled={busy}
            onAttach={pick}
          />
        )}
        <label>
          Jobsite photo
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(event) => {
              pick(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
        <p>
          JPEG, PNG, or WebP up to {fileSize(maxBytes)}. Photos wait in encrypted device storage
          until upload.
        </p>
        {persist.isPending && <p role="status">Saving on this device…</p>}
        {storageNotice && <p role="status">{storageNotice}</p>}
        {validation && (
          <p className="enterprise-error" role="alert">
            {validation}
          </p>
        )}
        {persist.isError && unsaved && (
          <div>
            <p className="enterprise-error" role="alert">
              {operationError(persist.error)}
            </p>
            <button type="button" disabled={busy} onClick={() => persist.mutate(unsaved)}>
              Retry saving on this device
            </button>
          </div>
        )}
        {queue.isError && (
          <div>
            <p className="enterprise-error" role="alert">
              {operationError(queue.error)}
            </p>
            <button type="button" onClick={() => void queue.refetch()}>
              Retry loading saved media
            </button>
          </div>
        )}
        {!!queue.data?.unavailable && (
          <p role="alert">Some saved files could not be opened on this device.</p>
        )}
        {draft && (
          <label>
            {maxVideoDurationMs || isVideo ? 'Saved media' : 'Saved photo'}
            <select
              value={draft.id}
              disabled={busy}
              onChange={(event) => {
                setSelected(event.target.value);
                setProgress(null);
                upload.reset();
              }}
            >
              {drafts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.filename}
                </option>
              ))}
            </select>
          </label>
        )}
        {draft && !online && (
          <p role="status">
            Offline. This {itemName} will stay on this device until you upload it.
          </p>
        )}
        {draft && !canUploadDraft && (
          <p role="status">Video processing is unavailable. This clip remains on this device.</p>
        )}
        {upload.isError && (
          <p className="enterprise-error" role="alert">
            {operationError(upload.error)}{' '}
            {isApiError(upload.error) && 'Support reference ' + upload.error.problem.correlationId}
          </p>
        )}
        {progress && (
          <p role="status">
            {progress.received} of {progress.total} parts uploaded
          </p>
        )}
        <button type="submit" disabled={!draft || !canUploadDraft || !online || busy}>
          {upload.isPending ? 'Uploading…' : upload.isError ? 'Retry upload' : 'Upload ' + itemName}
        </button>
      </form>
    </section>
  );
}
