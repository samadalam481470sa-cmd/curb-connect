// Roof insurance claims list: status, carrier, claim number, linked roof job, and a
// per-row link to the inspection report evidence. Not wired into any page or nav yet —
// the dashboard work wires it in later.
'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ErrorNotice } from '../../../components/common';
import { orgKey, useApi, useSession } from '../../../lib/session';
import {
  CLAIM_STATUSES,
  claimStatusLabel,
  INSPECTION_PAGE_PATH,
  RoofClaimListSchema,
  type ClaimStatus,
  type RoofClaim,
} from './claims';

function inspectionEvidence(doc: RoofClaim['documents'][number]): string | null {
  return doc.inspectionReportId;
}

export function ClaimsList({ onSelect }: { onSelect?: (claim: RoofClaim) => void }) {
  const { api } = useApi();
  const { orgId } = useSession();
  const [status, setStatus] = useState<ClaimStatus | ''>('');

  const claims = useQuery({
    queryKey: orgKey(orgId, 'roof-claims', status || 'all'),
    queryFn: () =>
      api.get('/v1/roof-claims', {
        schema: RoofClaimListSchema,
        query: status ? { status } : {},
      }),
    staleTime: 60_000,
  });

  if (claims.isError) {
    return (
      <ErrorNotice
        error={claims.error}
        title="Claims could not be loaded"
        onRetry={() => void claims.refetch()}
      />
    );
  }

  const items = claims.data?.items ?? [];

  return (
    <section aria-labelledby="roof-claims-title" className="cc-panel">
      <div className="cc-panel__body">
        <h2 id="roof-claims-title" style={{ marginBottom: 'var(--fl-space-3)' }}>
          Roof insurance claims
        </h2>
        <div style={{ marginBottom: 'var(--fl-space-3)' }}>
          <label htmlFor="roof-claims-status-filter" style={{ marginRight: 'var(--fl-space-2)' }}>
            Filter by status
          </label>
          <select
            id="roof-claims-status-filter"
            className="cc-input"
            value={status}
            onChange={(event) => setStatus(event.target.value as ClaimStatus | '')}
          >
            <option value="">All statuses</option>
            {CLAIM_STATUSES.map((s) => (
              <option key={s} value={s}>
                {claimStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        {claims.isPending ? (
          <p>Loading claims…</p>
        ) : items.length === 0 ? (
          <p>No claims yet. File one from a roof job to track it here.</p>
        ) : (
          <table className="cc-table">
            <thead>
              <tr>
                <th scope="col">Claim number</th>
                <th scope="col">Carrier</th>
                <th scope="col">Status</th>
                <th scope="col">Roof job</th>
                <th scope="col">Inspection evidence</th>
                <th scope="col">Filed</th>
              </tr>
            </thead>
            <tbody>
              {items.map((claim) => {
                const reportId = claim.documents.map(inspectionEvidence).find(Boolean) ?? null;
                return (
                  <tr key={claim.id}>
                    <td>
                      {onSelect ? (
                        <button
                          type="button"
                          className="cc-btn cc-btn--sm"
                          onClick={() => onSelect(claim)}
                          aria-label={`Open claim ${claim.claimNumber ?? claim.id}`}
                        >
                          {claim.claimNumber ?? '—'}
                        </button>
                      ) : (
                        (claim.claimNumber ?? '—')
                      )}
                    </td>
                    <td>{claim.carrier}</td>
                    <td>{claimStatusLabel(claim.status)}</td>
                    <td>{claim.roofOrderId}</td>
                    <td>
                      {reportId ? (
                        <a href={INSPECTION_PAGE_PATH}>Inspection report {reportId}</a>
                      ) : (
                        'No inspection report attached'
                      )}
                    </td>
                    <td>{new Date(claim.createdAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
