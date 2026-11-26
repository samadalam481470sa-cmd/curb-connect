'use client';

import { ContractorMediaJob, ContractorMediaJobs } from '@fieldline/contracts';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Skeleton } from '@fieldline/ui';
import Link from 'next/link';
import { ContractorEvidenceForm } from './ContractorEvidenceForm';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, SessionProvider, useApi, useMe } from '../../lib/session';
import { JobsiteCaption } from '../enterprise/JobsiteMediaCaption';
import { JobsiteMediaTaskLinks } from '../enterprise/JobsiteMediaTaskLinks';
import { JobsitePhotoIntake } from '../enterprise/JobsitePhotoIntake';

const jobsPath = '/portal/contractor/jobs';
const jobsApi = '/v1' + jobsPath;

const evidenceLabels = {
  unsubmitted: 'Evidence needed',
  pending: 'Awaiting inspection',
  approved: 'Evidence approved',
  changes_requested: 'Changes requested',
  rejected: 'Evidence rejected',
};

const fileLabels = {
  processing: 'Processing',
  available: 'Available',
  unavailable: 'Unavailable',
};

function accessDenied(error: unknown) {
  return isApiError(error) && [401, 403, 404].includes(error.status);
}

function PortalError({ error, retry }: { error: unknown; retry: () => void }) {
  const denied = accessDenied(error);
  return (
    <section className="enterprise-panel" role="alert">
      <p>{denied ? 'This contractor media workspace is unavailable.' : errorHint(error)}</p>
      {!denied && isApiError(error) && <p>Support reference {error.correlationId}</p>}
      {!denied && (
        <button type="button" onClick={retry}>
          Retry loading
        </button>
      )}
    </section>
  );
}

export function ContractorMediaPortal({ projectId }: { projectId?: string }) {
  const me = useMe();
  return (
    <main className="enterprise-suite enterprise-contractor-media">
      {projectId && (
        <nav aria-label="Contractor portal">
          <Link className="enterprise-back" href={jobsPath}>
            ← Assigned jobs
          </Link>
        </nav>
      )}
      <h1>{projectId ? 'Job media' : 'Assigned jobs'}</h1>
      {me.isPending && <Skeleton variant="card" label="Confirming contractor access" />}
      {me.error && <PortalError error={me.error} retry={() => void me.refetch()} />}
      {me.data && !me.data.activeOrgId && (
        <Link
          href={
            '/select-workspace?returnTo=' +
            encodeURIComponent(projectId ? jobsPath + '/' + projectId + '/media' : jobsPath)
          }
        >
          Choose your company
        </Link>
      )}
      {me.data?.activeOrgId && !me.error && (
        <SessionProvider me={me.data}>
          {projectId ? (
            <ContractorJobMedia
              orgId={me.data.activeOrgId}
              userId={me.data.user.id}
              projectId={projectId}
            />
          ) : (
            <ContractorJobs orgId={me.data.activeOrgId} userId={me.data.user.id} />
          )}
        </SessionProvider>
      )}
    </main>
  );
}

function ContractorJobs({ orgId, userId }: { orgId: string; userId: string }) {
  const { api } = useApi();
  const jobs = useInfiniteQuery({
    queryKey: orgKey(orgId, 'contractor-media-jobs', userId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(jobsApi, {
        schema: ContractorMediaJobs,
        query: { cursor: pageParam },
      }),
    getNextPageParam: (page) => page.nextCursor,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
  });

  if (jobs.isPending) return <Skeleton variant="card" label="Loading assigned jobs" />;
  if (jobs.isError) return <PortalError error={jobs.error} retry={() => void jobs.refetch()} />;
  const { pages } = jobs.data;
  const items = pages.flatMap((page) => page.items);
  return (
    <>
      <p>{pages[0]?.companyName}</p>
      {items.length ? (
        <ul className="enterprise-change-history" aria-label="Assigned contractor jobs">
          {items.map((job) => (
            <li key={job.id}>
              <Link href={jobsPath + '/' + job.id + '/media'}>{job.name}</Link>
              <span>
                {job.completedTaskCount} of {job.taskCount} assigned tasks complete
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <section className="enterprise-panel">
          <p>No jobs are assigned to this account. Ask your project manager for an assignment.</p>
        </section>
      )}
      {jobs.hasNextPage && (
        <button
          type="button"
          disabled={jobs.isFetchingNextPage}
          onClick={() => void jobs.fetchNextPage()}
        >
          {jobs.isFetchingNextPage ? 'Loading jobs…' : 'Load more jobs'}
        </button>
      )}
    </>
  );
}

function ContractorJobMedia({
  orgId,
  userId,
  projectId,
}: {
  orgId: string;
  userId: string;
  projectId: string;
}) {
  const { api } = useApi();
  const [selectedTask, setSelectedTask] = useState<string | null>(null);
  const [submissionNotice, setSubmissionNotice] = useState('');
  const path = jobsApi + '/' + projectId + '/media';
  const detail = useInfiniteQuery({
    queryKey: orgKey(orgId, 'contractor-job-media', userId, projectId),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api.get(path, { schema: ContractorMediaJob, query: { fileCursor: pageParam } }),
    getNextPageParam: (page) => page.nextFileCursor,
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) =>
        page.files.some((item) => item.status === 'processing'),
      )
        ? 4000
        : false,
    refetchOnMount: 'always',
    refetchOnReconnect: 'always',
  });

  if (detail.isPending) return <Skeleton variant="card" label="Loading assigned job media" />;
  if (detail.isError)
    return <PortalError error={detail.error} retry={() => void detail.refetch()} />;
  const page = detail.data.pages[0]!;
  const { companyName, job, tasks, canUpload, maxBytes, maxVideoDurationMs } = page;
  const files = detail.data.pages.flatMap((record) => record.files);
  return (
    <>
      <header className="enterprise-panel">
        <p>{companyName}</p>
        <h2>{job.name}</h2>
        <p>Job reference {job.id}</p>
        <p>
          {job.completedTaskCount} of {job.taskCount} assigned tasks complete
        </p>
      </header>
      <section className="enterprise-panel" aria-label="Assigned tasks">
        <h2>Assigned tasks</h2>
        {submissionNotice && <p role="status">{submissionNotice}</p>}
        <ul className="enterprise-change-history">
          {tasks.map((task) => (
            <li key={task.id}>
              <strong>{task.title}</strong>
              <span>{task.completed ? 'Task complete' : evidenceLabels[task.evidenceStatus]}</span>
              {task.evidenceRevision === null ? (
                <span>Required evidence files {task.requiredMedia}</span>
              ) : (
                <span>Evidence revision {task.evidenceRevision}</span>
              )}
              {selectedTask === task.id ? (
                <ContractorEvidenceForm
                  path={path + '/evidence/tasks/' + task.id}
                  onCancel={() => setSelectedTask(null)}
                  onSubmitted={(revision) => {
                    setSelectedTask(null);
                    setSubmissionNotice('Evidence revision ' + revision + ' submitted for review.');
                    void detail.refetch();
                  }}
                />
              ) : !task.completed &&
                ['unsubmitted', 'rejected', 'changes_requested'].includes(task.evidenceStatus) ? (
                <button
                  type="button"
                  onClick={() => {
                    setSubmissionNotice('');
                    setSelectedTask(task.id);
                  }}
                >
                  Prepare evidence for {task.title}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
      {canUpload && (
        <JobsitePhotoIntake
          key={orgId + ':' + userId + ':' + projectId}
          path={path}
          projectId={projectId}
          maxBytes={maxBytes}
          maxVideoDurationMs={maxVideoDurationMs}
          onUploaded={() => void detail.refetch()}
          onAccessLost={() => void detail.refetch()}
        />
      )}
      <section className="enterprise-panel" aria-label="Your media">
        <h2>Your media</h2>
        {files.length ? (
          <ul className="enterprise-change-history">
            {files.map((item) => (
              <li key={item.id}>
                <strong>{item.filename}</strong>
                <span>
                  {fileLabels[item.status]} · Revision {item.revision}
                </span>
                <time dateTime={item.capturedAt}>{new Date(item.capturedAt).toLocaleString()}</time>
                <JobsiteCaption
                  path={path + '/' + item.id + '/caption'}
                  initial={item.caption}
                  canEdit={item.canEditMetadata}
                  onSaved={() => void detail.refetch()}
                />
                <JobsiteMediaTaskLinks
                  projectId={projectId}
                  assetId={item.id}
                  canLink={item.canEditMetadata}
                  portal={{ mediaPath: path, tasks }}
                />
                {item.status === 'available' && (
                  <a href={path + '/files/' + item.id}>Download {item.filename}</a>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p>You have no uploaded media on this job.</p>
        )}
        {detail.hasNextPage && (
          <button
            type="button"
            disabled={detail.isFetchingNextPage}
            onClick={() => void detail.fetchNextPage()}
          >
            {detail.isFetchingNextPage ? 'Loading media…' : 'Load more media'}
          </button>
        )}
      </section>
    </>
  );
}
