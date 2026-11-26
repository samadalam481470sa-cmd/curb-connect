'use client';

import { JobsiteEvidenceDecision, type JobsiteEvidenceDecisionType } from '@fieldline/contracts';
import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import type { z } from 'zod';
import { errorHint, isApiError } from '../../lib/api';
import { useApi } from '../../lib/session';

type ReviewDecision = z.infer<typeof JobsiteEvidenceDecision>;

export const evidenceOutcomeLabels: Record<JobsiteEvidenceDecisionType, string> = {
  approved: 'Approved',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
};

export function JobsiteEvidenceDecisionEditor({
  path,
  revision,
  stale,
  onSaved,
  reload,
  cancel,
}: {
  path: string;
  revision: number;
  stale: boolean;
  onSaved: (decision: ReviewDecision) => void;
  reload: () => void;
  cancel: () => void;
}) {
  const { api } = useApi();
  const [decision, setDecision] = useState<JobsiteEvidenceDecisionType | ''>('');
  const [findings, setFindings] = useState('');
  const request = useRef<{ signature: string; id: string } | null>(null);
  const record = useMutation({
    mutationFn: (outcome: JobsiteEvidenceDecisionType) => {
      const body = { decision: outcome, findings: findings.trim() };
      const signature = JSON.stringify({ ...body, revision });
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      return api.post(
        path,
        { ...body, clientRequestId: request.current.id },
        {
          ifMatch: revision,
          schema: JobsiteEvidenceDecision,
        },
      );
    },
    onSuccess: onSaved,
    onError: (error) => {
      if (isApiError(error) && (error.is('precondition_failed') || error.is('conflict'))) reload();
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (decision && findings.trim() && !stale && !record.isPending) record.mutate(decision);
  }

  return (
    <form className="enterprise-form" onSubmit={submit} aria-label="Decide task evidence">
      <h3>Review evidence revision {revision}</h3>
      {stale && (
        <p role="alert">
          The evidence or decision changed. You can copy your findings before opening the current
          revision.
        </p>
      )}
      <label>
        Inspection decision
        <select
          value={decision}
          onChange={(event) =>
            setDecision(event.currentTarget.value as JobsiteEvidenceDecisionType | '')
          }
          required
          disabled={record.isPending || stale}
        >
          <option value="">Choose a decision</option>
          <option value="approved">Approve evidence</option>
          <option value="changes_requested">Request changes</option>
          <option value="rejected">Reject evidence</option>
        </select>
      </label>
      <label>
        Inspection findings
        <textarea
          value={findings}
          maxLength={1500}
          required
          readOnly={stale}
          disabled={record.isPending}
          onChange={(event) => setFindings(event.currentTarget.value)}
        />
      </label>
      {record.isError && (
        <p role="alert">
          {isApiError(record.error) && record.error.is('conflict')
            ? record.error.problem.detail || errorHint(record.error)
            : errorHint(record.error)}
        </p>
      )}
      <button type="submit" disabled={!decision || !findings.trim() || stale || record.isPending}>
        {record.isPending ? 'Saving inspection decision…' : 'Record inspection decision'}
      </button>
      <button type="button" disabled={record.isPending} onClick={cancel}>
        Cancel decision draft
      </button>
    </form>
  );
}
