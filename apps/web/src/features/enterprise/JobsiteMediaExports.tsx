'use client';

import {
  type JobsiteExportFormat,
  type JobsiteExportSelection,
  type JobsiteMediaAsset,
  JobsiteMediaExport,
  JobsiteMediaExportDownload,
  JobsiteMediaExports as ExportList,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const statuses = {
  queued: 'Queued',
  processing: 'Building package',
  ready: 'Ready',
  failed: 'Failed',
};
const failures: Record<string, string> = {
  too_large: 'The package exceeds 64 MiB. Select fewer files.',
  permission_lost: 'Project access changed before the package finished.',
  checksum_mismatch: 'One of the selected files could not be verified.',
  generation_failed: 'The file could not be generated. Submit a new package to try again.',
};

export function JobsiteMediaExports({
  path,
  media,
}: {
  path: string;
  media: z.infer<typeof JobsiteMediaAsset>[];
}) {
  const { api } = useApi();
  const { orgId } = useSession();
  const client = useQueryClient();
  const url = path + '/exports';
  const key = orgKey(orgId, 'enterprise', 'jobsite-media-exports', path);
  const [open, setOpen] = useState(false);
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [format, setFormat] = useState<JobsiteExportFormat>('zip');
  const [selection, setSelection] = useState<JobsiteExportSelection>('current');
  const [notice, setNotice] = useState('');
  const request = useRef<{ signature: string; id: string } | null>(null);
  const records = useQuery({
    queryKey: key,
    queryFn: () => api.get(url, { schema: ExportList }),
    enabled: open,
    refetchInterval: (query) =>
      query.state.data?.items.some(({ status }) => status === 'queued' || status === 'processing')
        ? 3000
        : false,
  });
  const available = media.filter(
    ({ scanState, videoState }) =>
      scanState === 'clean' && (videoState === null || videoState === 'ready'),
  );
  const selected = available.filter(({ id }) => mediaIds.includes(id));
  const queue = useMutation({
    mutationFn: () => {
      const body = { mediaIds: selected.map(({ id }) => id), format, selection };
      const signature = JSON.stringify(body);
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      return api.post(
        url,
        { ...body, clientRequestId: request.current.id },
        { schema: JobsiteMediaExport },
      );
    },
    onSuccess: (packageRow) => {
      client.setQueryData(key, (prior: z.infer<typeof ExportList> | undefined) => ({
        items: [packageRow, ...(prior?.items ?? []).filter(({ id }) => id !== packageRow.id)],
      }));
      setNotice(packageRow.format.toUpperCase() + ' package requested.');
      setMediaIds([]);
      request.current = null;
      void client.invalidateQueries({ queryKey: key, exact: true });
    },
  });
  const download = useMutation({
    mutationFn: (id: string) =>
      api.post(url + '/' + id + '/download-link', {}, { schema: JobsiteMediaExportDownload }),
    onSuccess: ({ href }) => window.location.assign(href),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (selected.length > 0 && !queue.isPending) queue.mutate();
  }

  return (
    <details className="enterprise-panel" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Media packages</summary>
      {open && (
        <div className="enterprise-form">
          {notice && <p role="status">{notice}</p>}
          <form className="enterprise-form" aria-label="Create media package" onSubmit={submit}>
            <label>
              Package format
              <select
                value={format}
                onChange={(event) => setFormat(event.currentTarget.value as JobsiteExportFormat)}
                disabled={queue.isPending}
              >
                <option value="zip">ZIP files and manifest</option>
                <option value="pdf">PDF index and photo previews</option>
              </select>
            </label>
            <label>
              File versions
              <select
                value={selection}
                onChange={(event) =>
                  setSelection(event.currentTarget.value as JobsiteExportSelection)
                }
                disabled={queue.isPending}
              >
                <option value="current">Current annotations and playback</option>
                <option value="original">Original files</option>
              </select>
            </label>
            {available.length === 0 ? (
              <p>Scanned photos and processed videos will appear here.</p>
            ) : (
              <fieldset>
                <legend>Project media</legend>
                {available.map(({ id, filename }) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={mediaIds.includes(id)}
                      disabled={
                        queue.isPending || (selected.length >= 40 && !mediaIds.includes(id))
                      }
                      onChange={(event) => {
                        const checked = event.currentTarget.checked;
                        setMediaIds((previous) =>
                          checked ? [...previous, id] : previous.filter((item) => item !== id),
                        );
                      }}
                    />
                    {filename}
                  </label>
                ))}
              </fieldset>
            )}
            {queue.isError && (
              <p role="alert">
                {isApiError(queue.error)
                  ? (queue.error.problem.detail ?? errorHint(queue.error))
                  : errorHint(queue.error)}
              </p>
            )}
            <button type="submit" disabled={queue.isPending || selected.length === 0}>
              {queue.isPending ? 'Requesting package…' : 'Create package'}
            </button>
          </form>
          {records.isPending && <p role="status">Loading media packages…</p>}
          {records.isError && (
            <div role="alert">
              <p>{errorHint(records.error)}</p>
              <button type="button" onClick={() => void records.refetch()}>
                Retry media packages
              </button>
            </div>
          )}
          {records.isSuccess && records.data.items.length > 0 && (
            <ul aria-label="Requested media packages" className="enterprise-change-history">
              {records.data.items.map((row) => (
                <li key={row.id}>
                  <strong>{row.format.toUpperCase()} package</strong>
                  <span>{statuses[row.status]}</span>
                  <time dateTime={row.createdAt}>{new Date(row.createdAt).toLocaleString()}</time>
                  <p>{row.manifest.map(({ name }) => name).join(', ')}</p>
                  {row.failureCode && (
                    <p role="alert">{failures[row.failureCode] ?? failures.generation_failed}</p>
                  )}
                  {row.status === 'ready' && (
                    <button
                      type="button"
                      disabled={download.isPending}
                      onClick={() => download.mutate(row.id)}
                    >
                      Download {row.format.toUpperCase()} package
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {download.isError && <p role="alert">{errorHint(download.error)}</p>}
        </div>
      )}
    </details>
  );
}
