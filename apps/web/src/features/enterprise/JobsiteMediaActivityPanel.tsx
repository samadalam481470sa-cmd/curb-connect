'use client';

import {
  JobsiteMediaActivity,
  type JobsiteMediaActivityAction,
  type JobsiteMediaIssue,
} from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { Drawer, Skeleton } from '@fieldline/ui';
import { useState } from 'react';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

const actions: Record<JobsiteMediaActivityAction, string> = {
  'media.capture_registered': 'Upload started',
  'media.upload_completed': 'Upload received',
  'media.scan_completed': 'Scan completed',
  'media.video_processing_completed': 'Video processing completed',
  'media.caption_changed': 'Caption saved',
  'media.task_linked': 'Linked to a task',
  'media.photo_annotated': 'Photo annotations saved',
};

const issues: Record<JobsiteMediaIssue, string> = {
  infected: 'Quarantined by the scanner',
  unsupported: 'Image could not be verified',
  scan_failed: 'Scanner unavailable',
  video_rejected: 'Video validation rejected the file',
  video_failed: 'Video processing failed',
};

export function JobsiteMediaActivityPanel({ path }: { path: string }) {
  const { api } = useApi();
  const { orgId } = useSession();
  const [drawer, setDrawer] = useState(false);
  const activity = useQuery({
    queryKey: orgKey(orgId, 'enterprise', 'jobsite-media-activity', path),
    queryFn: () => api.get(path + '/activity', { schema: JobsiteMediaActivity }),
    refetchInterval: 15_000,
  });

  const body = activity.isPending ? (
    <Skeleton variant="card" label="Loading media activity" />
  ) : activity.isError ? (
    <div role="alert">
      <p>{errorHint(activity.error)}</p>
      <button type="button" onClick={() => void activity.refetch()}>
        Retry media activity
      </button>
    </div>
  ) : (
    <>
      {activity.data.exceptions.length > 0 && (
        <section aria-label="Media exceptions">
          <h3>Needs attention</h3>
          <ul className="enterprise-media-activity-list">
            {activity.data.exceptions.map((item) => (
              <li key={item.mediaId}>
                <strong>{item.filename}</strong>
                <p>{issues[item.reason]}</p>
                <span>Revision {item.revision}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {activity.data.events.length === 0 ? (
        <p>No media activity yet.</p>
      ) : (
        <ol className="enterprise-media-activity-list" aria-label="Recent media events">
          {activity.data.events.map((event) => (
            <li key={event.id}>
              <strong>{event.filename}</strong>
              <p>{actions[event.action]}</p>
              <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
            </li>
          ))}
        </ol>
      )}
    </>
  );

  return (
    <>
      <aside
        className="enterprise-panel enterprise-media-activity"
        aria-label="Project media activity"
      >
        <h2>Activity and exceptions</h2>
        {body}
      </aside>
      <button
        type="button"
        className="enterprise-media-activity-trigger"
        onClick={() => setDrawer(true)}
      >
        Activity and exceptions
      </button>
      <Drawer title="Activity and exceptions" open={drawer} onClose={() => setDrawer(false)}>
        <div className="enterprise-media-activity-drawer">{body}</div>
      </Drawer>
    </>
  );
}
