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
import { Skeleton } from '@fieldline/ui';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

import { TakeoffResourceError, takeoffAccessDenied } from './TakeoffResourceError';

type Sheet = z.infer<typeof EnterpriseTakeoffPlanDetail>['sheets'][number];

const dimensions = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const PdfViewer = dynamic(
  () => import('./TakeoffPdfViewer').then((module) => module.TakeoffPdfViewer),
  {
    ssr: false,
    loading: () => <p role="status">Opening the viewer…</p>,
  },
);
const PlanComparison = dynamic(
  () => import('./TakeoffPlanComparison').then((module) => module.TakeoffPlanComparison),
  { ssr: false, loading: () => <p role="status">Opening comparison…</p> },
);

export function EnterpriseTakeoff({
  projectId,
  showProjectLink = true,
  initialSheet,
}: {
  projectId: string;
  showProjectLink?: boolean;
  initialSheet?: { planId: string; sheetId: string };
}) {
  const router = useRouter();
  const projectHref = '/enterprise/projects/' + projectId + '/takeoff';
  const { api } = useApi();
  const session = useSession();
  const client = useQueryClient();
  const [selected, setSelected] = useState(initialSheet?.planId ?? '');
  const [adding, setAdding] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [viewedSheetId, setViewedSheetId] = useState(initialSheet?.sheetId ?? '');
  const [viewerLaunch, setViewerLaunch] = useState(0);
  const viewerReturnFocus = useRef<HTMLButtonElement>(null);
  const compareButton = useRef<HTMLButtonElement>(null);
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
    retry: false,
  });
  const detail = useQuery({
    queryKey: [...key, 'plan', selected],
    queryFn: () =>
      api.get(path + '/plan-sets/' + selected, { schema: EnterpriseTakeoffPlanDetail }),
    enabled: selected !== '',
    retry: false,
  });
  const allowed = session.can('job:read') && !takeoffAccessDenied(list.error) && Boolean(list.data);
  const canEdit = allowed && session.can('estimate:write');
  const plans = allowed ? (list.data?.pages.flatMap((page) => page.items) ?? []) : [];
  const canCompare = plans.length > 1 || plans.some((plan) => plan.sourceCount > 1);
  const planDetail = takeoffAccessDenied(detail.error) ? undefined : detail.data;
  const activePlan = planDetail?.plan;
  const viewedSheet = planDetail?.sheets.find((sheet) => sheet.id === viewedSheetId);
  const groups = new Map<string, [Sheet, ...Sheet[]]>();
  for (const sheet of planDetail?.sheets ?? []) {
    const group = groups.get(sheet.sourceVersionId);
    if (group) group.push(sheet);
    else groups.set(sheet.sourceVersionId, [sheet]);
  }

  return (
    <section className="enterprise-panel">
      {!showProjectLink && (
        <nav aria-label="Takeoff breadcrumb">
          <Link href="/enterprise/takeoff">Digital Takeoff</Link>
          {initialSheet && (
            <>
              {' '}
              · <Link href={projectHref}>Project takeoff</Link>
            </>
          )}
        </nav>
      )}
      <header className="enterprise-control-head">
        <h2>Digital takeoff &amp; markup</h2>
        {allowed && (
          <div className="enterprise-toolbar">
            {showProjectLink && <Link href={projectHref}>Open project takeoff</Link>}
            {canEdit && !adding && (
              <button type="button" onClick={() => setAdding(true)}>
                Import plan set
              </button>
            )}
            {canEdit && canCompare && (
              <button
                type="button"
                ref={compareButton}
                aria-expanded={comparing}
                onClick={() => {
                  setComparing(!comparing);
                  setViewedSheetId('');
                }}
              >
                Compare revisions
              </button>
            )}
          </div>
        )}
      </header>
      {comparing && canEdit && (
        <PlanComparison
          path={path}
          projectPath={projectPath}
          queryKey={key}
          plans={plans}
          onClose={() => {
            setComparing(false);
            compareButton.current?.focus();
          }}
        />
      )}
      {adding && canEdit && (
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
      {list.isPending && <Skeleton label="Loading plan sets" variant="card" />}
      {list.isError && (
        <TakeoffResourceError
          error={list.error}
          unavailable="This project’s takeoff is unavailable."
          retry={() => void list.refetch()}
          retryLabel="Retry loading plan sets"
        />
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
            {selected && detail.isPending && (
              <Skeleton label="Loading plan sheets" variant="card" />
            )}
            {detail.isError && (
              <TakeoffResourceError
                error={detail.error}
                unavailable="This plan set is unavailable."
                retry={() => void detail.refetch()}
                retryLabel="Retry loading sheets"
              />
            )}
            {activePlan && (
              <>
                <h3>{activePlan.title}</h3>
                <p>
                  {activePlan.revisionLabel} · {activePlan.sheetCount} sheets
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
                            <th scope="col">Workspace</th>
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
                                    if (initialSheet) {
                                      router.push(takeoffSheetHref(activePlan.id, sheet.id));
                                      return;
                                    }
                                    setComparing(false);
                                    viewerReturnFocus.current = event.currentTarget;
                                    setViewerLaunch((launch) => launch + 1);
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
                              <td>
                                <Link
                                  href={takeoffSheetHref(activePlan.id, sheet.id)}
                                  aria-label={'Open sheet ' + sheet.pageLabel + ' workspace'}
                                >
                                  Open workspace
                                </Link>
                              </td>
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
      {allowed && viewedSheet && activePlan && (
        <PdfViewer
          key={viewedSheet.sourceVersionId + ':' + viewerLaunch}
          url={projectPath + '/document-versions/' + viewedSheet.sourceVersionId + '/download'}
          projectId={projectId}
          planId={activePlan.id}
          takeoffPath={path}
          sheetPath={path + '/plan-sets/' + activePlan.id + '/sheets/' + viewedSheet.id}
          sheet={viewedSheet}
          siblings={groups.get(viewedSheet.sourceVersionId) ?? []}
          revisionLabel={activePlan.revisionLabel}
          onView={(sheetId) => {
            if (initialSheet) {
              router.replace(takeoffSheetHref(activePlan.id, sheetId), { scroll: false });
            } else {
              setViewedSheetId(sheetId);
            }
          }}
          onClose={() => {
            if (initialSheet) {
              router.push(projectHref);
            } else {
              setViewedSheetId('');
              viewerReturnFocus.current?.focus();
            }
          }}
        />
      )}
    </section>
  );
}

function takeoffSheetHref(planId: string, sheetId: string) {
  return '/enterprise/takeoff/' + planId + '/sheets/' + sheetId;
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
