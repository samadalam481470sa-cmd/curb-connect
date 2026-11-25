'use client';

import {
  EnterpriseTakeoffPlan,
  EnterpriseTakeoffPlanDetail,
  EnterpriseTakeoffPlanInput,
  EnterpriseTakeoffPlanPage,
  EnterpriseTakeoffSourcePage,
  MAX_TAKEOFF_SHEETS,
  MAX_TAKEOFF_SOURCE_FILES,
} from '@fieldline/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type Sheet = z.infer<typeof EnterpriseTakeoffPlanDetail>['sheets'][number];

const dimensions = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const PdfViewer = dynamic(
  () => import('./TakeoffPdfViewer').then((module) => module.TakeoffPdfViewer),
  {
    ssr: false,
    loading: () => <p role="status">Opening the viewer…</p>,
  },
);

export function EnterpriseTakeoff({ projectId }: { projectId: string }) {
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const [selected, setSelected] = useState('');
  const [adding, setAdding] = useState(false);
  const [viewedSheetId, setViewedSheetId] = useState('');
  const viewerReturnFocus = useRef<HTMLButtonElement>(null);
  const projectPath = '/v1/enterprise/projects/' + encodeURIComponent(projectId);
  const path = projectPath + '/takeoff';
  const key = [...orgKey(session.orgId, 'enterprise'), 'takeoff', projectId];
  const list = useInfiniteQuery({
    queryKey: [...key, 'plans'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path + '/plan-sets', {
        query: { cursor: pageParam },
        schema: EnterpriseTakeoffPlanPage,
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const detail = useQuery({
    queryKey: [...key, 'plan', selected],
    queryFn: () =>
      api.get(path + '/plan-sets/' + selected, { schema: EnterpriseTakeoffPlanDetail }),
    enabled: selected !== '',
  });
  const plans = list.data?.pages.flatMap((page) => page.items) ?? [];
  const viewedSheet = detail.data?.sheets.find((sheet) => sheet.id === viewedSheetId);
  const groups = new Map<string, [Sheet, ...Sheet[]]>();
  for (const sheet of detail.data?.sheets ?? []) {
    const group = groups.get(sheet.sourceVersionId);
    if (group) group.push(sheet);
    else groups.set(sheet.sourceVersionId, [sheet]);
  }

  return (
    <section className="enterprise-panel">
      <header className="enterprise-control-head">
        <h2>Digital takeoff &amp; markup</h2>
        {session.can('estimate:write') && !adding && (
          <button type="button" onClick={() => setAdding(true)}>
            Import plan set
          </button>
        )}
      </header>
      {adding && (
        <PlanImportForm
          path={path}
          sourcesKey={[...key, 'sources']}
          onCancel={() => setAdding(false)}
          onSaved={async (plan) => {
            setSelected(plan.id);
            setViewedSheetId('');
            setAdding(false);
            await client.invalidateQueries({ queryKey: [...key, 'plans'] });
          }}
        />
      )}
      {list.isPending && <p role="status">Loading plan sets…</p>}
      {list.isError && (
        <p className="enterprise-error" role="alert">
          {errorHint(list.error)}
        </p>
      )}
      {list.isSuccess && !plans.length && (
        <p className="enterprise-empty">This project has no imported plan sets.</p>
      )}
      {!!plans.length && (
        <div className="enterprise-vault-layout">
          <div>
            <ul className="enterprise-vault-index">
              {plans.map((plan) => (
                <li key={plan.id}>
                  <button
                    type="button"
                    aria-pressed={selected === plan.id}
                    onClick={() => {
                      setSelected(plan.id);
                      setViewedSheetId('');
                    }}
                  >
                    <strong>{plan.title}</strong>
                    <span>
                      {plan.revisionLabel} · {plan.sheetCount}{' '}
                      {plan.sheetCount === 1 ? 'sheet' : 'sheets'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {list.hasNextPage && (
              <button
                type="button"
                disabled={list.isFetchingNextPage}
                onClick={() => void list.fetchNextPage()}
              >
                Load more plan sets
              </button>
            )}
          </div>
          <div>
            {!selected && <p className="enterprise-empty">Select a plan set to see its sheets.</p>}
            {selected && detail.isPending && <p role="status">Loading sheets…</p>}
            {detail.isError && (
              <div>
                <p className="enterprise-error" role="alert">
                  {errorHint(detail.error)}
                </p>
                <button type="button" onClick={() => void detail.refetch()}>
                  Retry loading sheets
                </button>
              </div>
            )}
            {detail.data && (
              <>
                <h3>{detail.data.plan.title}</h3>
                <p>
                  {detail.data.plan.revisionLabel} · {detail.data.plan.sheetCount} sheets
                </p>
                {[...groups].map(([sourceId, [first, ...otherSheets]]) => (
                  <section key={sourceId}>
                    <h4>
                      {first.sourceTitle} · Vault version {first.sourceRevision}
                    </h4>
                    <p>
                      <a href={projectPath + '/document-versions/' + sourceId + '/download'}>
                        Download {first.sourceFilename}
                      </a>
                      {' · '}
                      {first.scanStatus === 'clean' ? 'Scan passed' : 'Scan unavailable'}
                    </p>
                    <div className="enterprise-scroll">
                      <table aria-label={'Sheets in ' + first.sourceFilename}>
                        <thead>
                          <tr>
                            <th scope="col">Sheet</th>
                            <th scope="col">PDF page</th>
                            <th scope="col">Page dimensions (pt)</th>
                            <th scope="col">Rotation</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[first, ...otherSheets].map((sheet) => (
                            <tr key={sheet.id}>
                              <th scope="row">
                                <button
                                  type="button"
                                  aria-label={'Open sheet ' + sheet.pageLabel}
                                  aria-pressed={sheet.id === viewedSheetId}
                                  onClick={(event) => {
                                    viewerReturnFocus.current = event.currentTarget;
                                    setViewedSheetId(sheet.id);
                                  }}
                                >
                                  {sheet.pageLabel}
                                </button>
                              </th>
                              <td>{sheet.pageNumber}</td>
                              <td>
                                {dimensions.format(sheet.widthPoints)} ×{' '}
                                {dimensions.format(sheet.heightPoints)}
                              </td>
                              <td>{sheet.rotation}°</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </>
            )}
          </div>
        </div>
      )}
      {viewedSheet && detail.data && (
        <PdfViewer
          key={viewedSheet.sourceVersionId}
          url={projectPath + '/document-versions/' + viewedSheet.sourceVersionId + '/download'}
          sheet={viewedSheet}
          siblings={groups.get(viewedSheet.sourceVersionId) ?? []}
          revisionLabel={detail.data.plan.revisionLabel}
          onView={setViewedSheetId}
          onClose={() => {
            setViewedSheetId('');
            viewerReturnFocus.current?.focus();
          }}
        />
      )}
    </section>
  );
}

function PlanImportForm({
  path,
  sourcesKey,
  onCancel,
  onSaved,
}: {
  path: string;
  sourcesKey: readonly unknown[];
  onCancel: () => void;
  onSaved: (plan: EnterpriseTakeoffPlan) => Promise<void>;
}) {
  const { api } = useApi();
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const retry = useRef<{ key: string; id: string } | null>(null);
  const sources = useInfiniteQuery({
    queryKey: sourcesKey,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path + '/sources', {
        query: { cursor: pageParam },
        schema: EnterpriseTakeoffSourcePage,
      }),
    getNextPageParam: (page) => page.nextCursor,
  });
  const mutation = useMutation({
    mutationFn: (input: z.infer<typeof EnterpriseTakeoffPlanInput>) =>
      api.post(path + '/plan-sets', input, { schema: EnterpriseTakeoffPlan }),
    onSuccess: onSaved,
  });
  const options = sources.data?.pages.flatMap((page) => page.items) ?? [];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutation.isPending) return;
    setError('');
    const fields = new FormData(event.currentTarget);
    const values = {
      title: fields.get('title'),
      revisionLabel: fields.get('revisionLabel'),
      versionIds: selected,
    };
    try {
      const key = JSON.stringify(values);
      if (retry.current?.key !== key) retry.current = { key, id: crypto.randomUUID() };
      await mutation.mutateAsync(
        EnterpriseTakeoffPlanInput.parse({ ...values, clientRequestId: retry.current.id }),
      );
    } catch (cause) {
      if (cause instanceof z.ZodError) {
        setError(cause.issues[0]?.message ?? 'Check the plan set fields.');
      } else {
        setError(isApiError(cause) && cause.kind !== 'network' ? cause.message : errorHint(cause));
      }
    }
  }

  return (
    <form className="enterprise-form" onSubmit={(event) => void submit(event)}>
      <label>
        Plan set name <input name="title" required minLength={2} maxLength={180} />
      </label>
      <label>
        Revision label <input name="revisionLabel" required maxLength={60} />
      </label>
      <fieldset disabled={mutation.isPending}>
        <legend>Plan PDFs from the Document Vault</legend>
        <p>
          Choose up to {MAX_TAKEOFF_SOURCE_FILES} files and {MAX_TAKEOFF_SHEETS} sheets per plan
          set.
        </p>
        {sources.isPending && <p role="status">Loading plan PDFs…</p>}
        {sources.isError && (
          <div>
            <p role="alert" className="enterprise-error">
              {errorHint(sources.error)}
            </p>
            <button type="button" onClick={() => void sources.refetch()}>
              Retry loading plan PDFs
            </button>
          </div>
        )}
        {sources.isSuccess && !options.length && (
          <p>
            Upload a plan PDF in the <Link href="/enterprise/vault">Document Vault</Link> first.
          </p>
        )}
        <ul>
          {options.map((source) => (
            <li key={source.versionId}>
              <label>
                <input
                  type="checkbox"
                  checked={selected.includes(source.versionId)}
                  disabled={
                    selected.length >= MAX_TAKEOFF_SOURCE_FILES &&
                    !selected.includes(source.versionId)
                  }
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setSelected((versions) =>
                      checked
                        ? [...versions, source.versionId]
                        : versions.filter((id) => id !== source.versionId),
                    );
                  }}
                />
                {source.title} · Vault version {source.version} · {source.filename}
              </label>
            </li>
          ))}
        </ul>
        {sources.hasNextPage && (
          <button
            type="button"
            disabled={sources.isFetchingNextPage}
            onClick={() => void sources.fetchNextPage()}
          >
            Load more plan PDFs
          </button>
        )}
      </fieldset>
      {error && (
        <p className="enterprise-error" role="alert">
          {error}
        </p>
      )}
      <div className="enterprise-actions">
        <button type="submit" disabled={mutation.isPending || !selected.length}>
          {mutation.isPending ? 'Reading plan sheets…' : 'Create plan set'}
        </button>
        <button type="button" disabled={mutation.isPending} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
