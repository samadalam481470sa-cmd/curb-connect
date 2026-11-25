'use client';

import {
  type ExportTakeoffMarkup,
  TakeoffMarkupExport as ExportReceipt,
  TakeoffMarkupExportPage,
  TakeoffMarkupPreview,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const layerLabels = { length: 'Lengths', area: 'Net areas', count: 'Counts' } as const;
type Layer = keyof typeof layerLabels;
const layerOptions: Layer[] = ['length', 'area', 'count'];

export function TakeoffMarkupExport({
  sheetPath,
  sheetId,
  planId,
}: {
  sheetPath: string;
  sheetId: string;
  planId: string;
}) {
  const session = useSession();
  const [opened, setOpened] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (opened) editor.current?.focus();
  }, [opened]);
  if (!session.can('estimate:write')) return null;
  return (
    <section className="enterprise-stack" aria-label="Takeoff markup export">
      <button
        ref={opener}
        type="button"
        aria-expanded={opened}
        disabled={opened}
        onClick={() => setOpened(true)}
      >
        Export markup
      </button>
      {opened && (
        <MarkupForm
          key={sheetId}
          path={sheetPath + '/markup-exports'}
          sheetId={sheetId}
          planId={planId}
          heading={editor}
          close={() => {
            setOpened(false);
            requestAnimationFrame(() => opener.current?.focus());
          }}
        />
      )}
    </section>
  );
}

function MarkupForm({
  path,
  sheetId,
  planId,
  heading,
  close,
}: {
  path: string;
  sheetId: string;
  planId: string;
  heading: React.RefObject<HTMLHeadingElement | null>;
  close: () => void;
}) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const key = [...orgKey(session.orgId, 'enterprise'), 'takeoff-markup', planId, sheetId];
  const historyKey = [...key, 'exports'];
  const [layers, setLayers] = useState<Layer[]>(layerOptions);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<z.infer<typeof ExportReceipt> | null>(null);
  const retry = useRef<{ digest: string; id: string } | null>(null);
  const preview = useQuery({
    queryKey: [...key, 'preview', layers],
    enabled: layers.length > 0,
    queryFn: () =>
      api.post(path + '/preview', { visibleLayers: layers }, { schema: TakeoffMarkupPreview }),
  });
  const history = useInfiniteQuery({
    queryKey: historyKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, { query: { cursor: pageParam }, schema: TakeoffMarkupExportPage }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const save = useMutation({
    mutationFn: (body: z.infer<typeof ExportTakeoffMarkup>) =>
      api.post(path, body, { schema: ExportReceipt }),
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const review = preview.data;
    if (!review?.approvedCount || save.isPending || preview.isFetching) return;
    setError('');
    setReceipt(null);
    if (retry.current?.digest !== review.selectionDigest)
      retry.current = { digest: review.selectionDigest, id: crypto.randomUUID() };
    try {
      const exported = await save.mutateAsync({
        sheetId,
        revisionId: planId,
        format: 'pdf',
        visibleLayers: review.visibleLayers,
        selectionDigest: review.selectionDigest,
        clientRequestId: retry.current.id,
      });
      setReceipt(exported);
      retry.current = null;
      await client.invalidateQueries({ queryKey: historyKey });
    } catch (cause) {
      if (isApiError(cause) && cause.kind === 'problem') {
        setError(cause.message);
        if (cause.status === 409) await preview.refetch();
      } else {
        setError(errorHint(cause));
      }
    }
  }

  return (
    <div className="enterprise-stack">
      <h5 ref={heading} tabIndex={-1}>
        Markup PDF
      </h5>
      <form
        className="enterprise-form"
        aria-label="Export approved markup PDF"
        onSubmit={(event) => void submit(event)}
      >
        <fieldset disabled={save.isPending}>
          <legend>Include approved layers</legend>
          {layerOptions.map((layer) => (
            <label key={layer}>
              <input
                type="checkbox"
                checked={layers.includes(layer)}
                onChange={(event) => {
                  setLayers(
                    event.target.checked
                      ? layerOptions.filter((item) => item === layer || layers.includes(item))
                      : layers.filter((item) => item !== layer),
                  );
                  setError('');
                }}
              />
              {layerLabels[layer]}
            </label>
          ))}
        </fieldset>
        {layers.length === 0 ? <p>Select a layer to review its approved totals.</p> : null}
        {layers.length > 0 && preview.isFetching && <p role="status">Checking approvals…</p>}
        {preview.isError && (
          <p role="alert" className="enterprise-error">
            {errorHint(preview.error)}
          </p>
        )}
        {preview.data && (
          <div>
            <p>
              Revision {preview.data.revisionLabel} · {preview.data.scaleLabel}
            </p>
            <p>{preview.data.approvedCount} approved measurements</p>
            {preview.data.totals.length > 0 && (
              <ul aria-label="Selected approved totals">
                {preview.data.totals.map((total) => (
                  <li key={total.layer + total.unit}>
                    {layerLabels[total.layer]} · {total.quantity} {total.unit}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <button
          type="submit"
          disabled={
            !preview.data?.approvedCount || preview.isFetching || preview.isError || save.isPending
          }
        >
          {save.isPending ? 'Creating PDF…' : 'Create markup PDF'}
        </button>
        <button type="button" disabled={save.isPending} onClick={close}>
          Close markup export
        </button>
      </form>
      {error && (
        <p role="alert" className="enterprise-error">
          {error}
        </p>
      )}
      {receipt && (
        <p role="status">
          Markup PDF ready ·{' '}
          <a href={path + '/' + receipt.id + '/download'} download={receipt.filename}>
            Download markup PDF
          </a>
        </p>
      )}
      {(history.data?.pages[0]?.items.length ?? 0) > 0 && (
        <details>
          <summary>Saved markup exports</summary>
          <ul>
            {history.data?.pages
              .flatMap((page) => page.items)
              .map((item) => (
                <li key={item.id}>
                  <a href={path + '/' + item.id + '/download'} download={item.filename}>
                    {item.filename}
                  </a>
                  {' · '}
                  <time dateTime={item.createdAt}>{item.createdAt.slice(0, 10)}</time>
                </li>
              ))}
          </ul>
          {history.hasNextPage && (
            <button
              type="button"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              Load earlier exports
            </button>
          )}
        </details>
      )}
      {history.isError && (
        <p role="alert" className="enterprise-error">
          {errorHint(history.error)}
        </p>
      )}
    </div>
  );
}
