'use client';

import {
  JobsiteCustomerPhotoApproval,
  JobsiteCustomerPhotoPreview as CustomerPhotoPreview,
  JobsiteCustomerPhotoView,
} from '@fieldline/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';

type PreviewView = z.infer<typeof JobsiteCustomerPhotoView>;

export function JobsiteCustomerPhotoPreview({ path }: { path: string }) {
  const { api } = useApi();
  const { orgId } = useSession();
  const client = useQueryClient();
  const key = orgKey(orgId, 'enterprise', 'jobsite-customer-photo-preview', path);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const prepareRequest = useRef<{ signature: string; id: string } | null>(null);
  const approvalRequest = useRef<{ signature: string; id: string } | null>(null);
  const query = useQuery({
    queryKey: key,
    queryFn: () => api.get(path, { schema: JobsiteCustomerPhotoView }),
    enabled: open,
  });

  function refreshForConflict(error: unknown) {
    if (isApiError(error) && (error.is('precondition_failed') || error.is('conflict')))
      void query.refetch();
  }

  const prepare = useMutation({
    mutationFn: ({ revision, annotationRevision }: PreviewView) => {
      const signature = JSON.stringify({ revision, annotationRevision });
      if (prepareRequest.current?.signature !== signature)
        prepareRequest.current = { signature, id: crypto.randomUUID() };
      return api.post(
        path,
        {
          baseAnnotationRevision: annotationRevision,
          clientRequestId: prepareRequest.current.id,
        },
        { ifMatch: revision, schema: CustomerPhotoPreview },
      );
    },
    onSuccess: (preview) => {
      prepareRequest.current = null;
      setReviewed(null);
      client.setQueryData(key, (previous: PreviewView | undefined) =>
        previous && previous.revision <= preview.revision
          ? {
              ...previous,
              preview,
              revision: preview.revision,
              current: previous.annotationRevision === preview.sourceAnnotationRevision,
            }
          : previous,
      );
      setNotice('Customer preview prepared.');
      void client.invalidateQueries({ queryKey: key, exact: true });
    },
    onError: refreshForConflict,
  });

  const approve = useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) => {
      const signature = JSON.stringify({ id, revision, reason: reason.trim() });
      if (approvalRequest.current?.signature !== signature)
        approvalRequest.current = { signature, id: crypto.randomUUID() };
      return api.post(
        path + '/' + id + '/approve',
        {
          confirmedCustomerSafe: true,
          reason: reason.trim(),
          clientRequestId: approvalRequest.current.id,
        },
        { ifMatch: revision, schema: JobsiteCustomerPhotoApproval },
      );
    },
    onSuccess: (approval) => {
      approvalRequest.current = null;
      client.setQueryData(key, (previous: PreviewView | undefined) =>
        previous?.preview?.id === approval.previewId ? { ...previous, approval } : previous,
      );
      setReason('');
      setReviewed(null);
      setNotice('Customer photo preview approved.');
      void client.invalidateQueries({ queryKey: key, exact: true });
    },
    onError: refreshForConflict,
  });

  const view = query.isSuccess ? query.data : undefined;
  const preview = view?.preview;
  const busy = prepare.isPending || approve.isPending;
  const canApprove =
    !!view?.current &&
    !!preview &&
    loaded === preview.id &&
    reviewed === preview.id &&
    reason.trim().length >= 3 &&
    !busy;

  function saveApproval(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (preview && canApprove) approve.mutate({ id: preview.id, revision: preview.revision });
  }

  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Customer photo preview</summary>
      {open && query.isPending && <p role="status">Loading customer photo preview…</p>}
      {open && query.isError && (
        <div role="alert">
          <p>{errorHint(query.error)}</p>
          <button type="button" onClick={() => void query.refetch()}>
            Retry customer preview
          </button>
        </div>
      )}
      {open && view && (
        <section
          className="enterprise-photo-annotations"
          aria-label="Customer photo preview controls"
        >
          {notice && <p role="status">{notice}</p>}
          {!view.current && (
            <>
              <p>
                {preview
                  ? 'Photo annotations changed. Prepare a new preview to review the current redactions.'
                  : 'Prepare a preview to review what a homeowner could see.'}
              </p>
              <button type="button" disabled={busy} onClick={() => prepare.mutate(view)}>
                {prepare.isPending ? 'Preparing customer preview…' : 'Prepare customer preview'}
              </button>
            </>
          )}
          {prepare.isError && <p role="alert">{errorHint(prepare.error)}</p>}
          {preview && (
            <>
              <Image
                unoptimized
                src={path + '/' + preview.id + '/image'}
                alt={'Customer photo preview, revision ' + preview.revision}
                width={preview.width}
                height={preview.height}
                className="enterprise-photo-annotation-result"
                onLoad={() => setLoaded(preview.id)}
              />
              <p>
                {preview.redactionCount} opaque{' '}
                {preview.redactionCount === 1 ? 'redaction' : 'redactions'}
              </p>
              {view.approval?.previewId === preview.id && (
                <p>{view.current ? 'Approved for homeowner sharing' : 'Prior approval'}</p>
              )}
              {view.current && view.approval?.previewId !== preview.id && (
                <form
                  className="enterprise-form"
                  aria-label="Approve customer photo preview"
                  onSubmit={saveApproval}
                >
                  <label>
                    <input
                      type="checkbox"
                      checked={reviewed === preview.id}
                      disabled={busy || loaded !== preview.id}
                      onChange={(event) =>
                        setReviewed(event.currentTarget.checked ? preview.id : null)
                      }
                    />
                    I reviewed this image for homeowner visibility
                  </label>
                  <label>
                    Approval reason
                    <textarea
                      minLength={3}
                      maxLength={500}
                      value={reason}
                      disabled={busy}
                      onChange={(event) => setReason(event.currentTarget.value)}
                      required
                    />
                  </label>
                  <button type="submit" disabled={!canApprove}>
                    {approve.isPending ? 'Approving photo…' : 'Approve preview'}
                  </button>
                  {(reason || reviewed) && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setReason('');
                        setReviewed(null);
                        approve.reset();
                      }}
                    >
                      Cancel approval draft
                    </button>
                  )}
                </form>
              )}
              {approve.isError && <p role="alert">{errorHint(approve.error)}</p>}
              <button type="button" disabled={busy} onClick={() => void query.refetch()}>
                Refresh preview status
              </button>
            </>
          )}
        </section>
      )}
    </details>
  );
}
