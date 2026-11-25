// One roof insurance claim: status stepper, adjuster/carrier fields, evidence
// documents, and the next allowed status move. Not wired into any page or nav yet.
'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice } from '../../../components/common';
import { orgKey, useApi, useSession } from '../../../lib/session';
import {
  CLAIM_STEPPER,
  claimStatusLabel,
  INSPECTION_PAGE_PATH,
  nextClaimStatus,
  RoofClaimSchema,
  type RoofClaim,
} from './claims';

const DOCUMENT_KIND_LABELS: Record<string, string> = {
  inspection_report: 'Inspection report',
  photo: 'Photo',
  estimate: 'Estimate',
  correspondence: 'Correspondence',
  other: 'Other',
};

export function ClaimDetail({ claimId }: { claimId: string }) {
  const { api } = useApi();
  const { orgId } = useSession();
  const queryClient = useQueryClient();
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const claimQuery = useQuery({
    queryKey: orgKey(orgId, 'roof-claims', claimId),
    queryFn: () => api.get(`/v1/roof-claims/${claimId}`, { schema: RoofClaimSchema }),
    staleTime: 60_000,
  });

  const advance = useMutation({
    mutationFn: (next: string) =>
      api.patch(`/v1/roof-claims/${claimId}`, { status: next }, { schema: RoofClaimSchema }),
    onSuccess: () => {
      setAdvanceError(null);
      void queryClient.invalidateQueries({ queryKey: orgKey(orgId, 'roof-claims') });
    },
    onError: (error: unknown) => {
      setAdvanceError(error instanceof Error ? error.message : 'The status could not be changed.');
    },
  });

  if (claimQuery.isError) {
    return (
      <ErrorNotice
        error={claimQuery.error}
        title="Claim could not be loaded"
        onRetry={() => void claimQuery.refetch()}
      />
    );
  }
  if (claimQuery.isPending) return <p>Loading claim…</p>;

  const claim: RoofClaim = claimQuery.data;
  const next = nextClaimStatus(claim.status);
  const reached =
    claim.status === 'denied'
      ? CLAIM_STEPPER.indexOf('estimate_submitted')
      : CLAIM_STEPPER.indexOf(claim.status);

  return (
    <section aria-labelledby="roof-claim-detail-title" className="cc-panel">
      <div className="cc-panel__body">
        <h2 id="roof-claim-detail-title" style={{ marginBottom: 'var(--fl-space-3)' }}>
          Claim {claim.claimNumber ?? claim.id}
        </h2>

        <ol
          aria-label="Claim progress"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'var(--fl-space-2)',
            listStyle: 'none',
            padding: 0,
            marginBottom: 'var(--fl-space-4)',
          }}
        >
          {CLAIM_STEPPER.map((step, i) => (
            <li
              key={step}
              aria-current={claim.status === step ? 'step' : undefined}
              style={{ fontWeight: claim.status === step ? 700 : 400 }}
            >
              {i + 1}. {claimStatusLabel(step)}
              {i <= reached ? ' ✓' : ''}
            </li>
          ))}
          {claim.status === 'denied' ? (
            <li aria-current="step">
              <strong>Denied</strong>
            </li>
          ) : null}
        </ol>

        <dl
          style={{ display: 'grid', gap: 'var(--fl-space-2)', marginBottom: 'var(--fl-space-4)' }}
        >
          <div>
            <dt>Carrier</dt>
            <dd>{claim.carrier}</dd>
          </div>
          <div>
            <dt>Adjuster</dt>
            <dd>{claim.adjusterName ?? 'Not assigned yet'}</dd>
          </div>
          <div>
            <dt>Adjuster contact</dt>
            <dd>{claim.adjusterContact ?? 'Not provided'}</dd>
          </div>
          <div>
            <dt>Roof job</dt>
            <dd>{claim.roofOrderId}</dd>
          </div>
          {claim.note ? (
            <div>
              <dt>Note</dt>
              <dd>{claim.note}</dd>
            </div>
          ) : null}
        </dl>

        <h3 id="roof-claim-documents-title" style={{ marginBottom: 'var(--fl-space-2)' }}>
          Evidence documents
        </h3>
        {claim.documents.length === 0 ? (
          <p aria-labelledby="roof-claim-documents-title">No documents attached yet.</p>
        ) : (
          <ul
            aria-labelledby="roof-claim-documents-title"
            style={{ marginBottom: 'var(--fl-space-4)' }}
          >
            {claim.documents.map((doc) => (
              <li key={doc.id}>
                {DOCUMENT_KIND_LABELS[doc.kind] ?? 'Other'}
                {doc.label ? ` — ${doc.label}` : ''}
                {doc.inspectionReportId ? (
                  <>
                    {' — '}
                    <a href={INSPECTION_PAGE_PATH}>Inspection report {doc.inspectionReportId}</a>
                  </>
                ) : null}
                {doc.mediaAssetId ? ` — stored photo ${doc.mediaAssetId}` : null}
              </li>
            ))}
          </ul>
        )}

        {next ? (
          <div>
            <button
              type="button"
              className="cc-btn cc-btn--primary"
              disabled={advance.isPending}
              onClick={() => advance.mutate(next)}
              aria-label={`Move claim to ${claimStatusLabel(next)}`}
            >
              {advance.isPending ? 'Moving…' : `Move to ${claimStatusLabel(next)}`}
            </button>
            {advanceError ? (
              <p role="alert" style={{ marginTop: 'var(--fl-space-2)' }}>
                {advanceError}
              </p>
            ) : null}
          </div>
        ) : (
          <p>
            {claim.status === 'settled'
              ? 'This claim is settled — no further moves.'
              : 'This claim was denied — file a new claim to try again.'}
          </p>
        )}
      </div>
    </section>
  );
}
