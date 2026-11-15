'use client';

// Curb estimates on a project: created only through POST /curb/projects/{id}/estimates so site
// conditions are derived server-side (never caller supplied). Hidden until every early
// eligibility / permit question is answered (CV-042 B: questions before any price). Stale
// estimates are repriced with the sync command.
import { Button, Field, TextInput } from '@fieldline/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { newIdempotencyKey } from '../../lib/api';
import { useSession } from '../../lib/session';
import { ButtonLink, ErrorNotice } from '../common';
import { Panel } from './CurbCommon';
import { EstimateView } from './EstimateView';
import { earlyQuestionsAnswered } from './model';
import { curbKeys, useCurbProject } from './useCurbProject';

interface LineDraft {
  code: string;
  quantityKey: string;
  quantity: string;
}

export function EstimatesPanel({ onTab }: { onTab?: (t: string) => void }) {
  const { detail, projectId, curb } = useCurbProject();
  const session = useSession();
  const qc = useQueryClient();
  const keys = curbKeys(session.orgId, projectId);
  const gate = earlyQuestionsAnswered(detail?.observations ?? []);
  const list = useQuery({ queryKey: keys.estimates, queryFn: () => curb.estimates(projectId), enabled: gate.done });
  const [lines, setLines] = useState<LineDraft[]>([{ code: '', quantityKey: 'cut_length', quantity: '' }]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdempotencyKey());

  if (!gate.done) {
    return (
      <Panel title="Estimate" id="estimate">
        <p className="curb-warn" role="status">
          No price is shown until the permit, ownership and risk questions are answered ({gate.missing.length} left). Unknown is a valid answer.
        </p>
        {onTab && <Button onClick={() => onTab('intake')}>Answer the questions</Button>}
      </Panel>
    );
  }

  const valid = lines.every((l) => /^[A-Z0-9_]{2,40}$/.test(l.code) && (l.quantityKey !== '') !== (l.quantity !== ''));
  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await curb.createEstimate(projectId, { lines: lines.map((l) => ({ code: l.code, ...(l.quantityKey ? { quantityKey: l.quantityKey } : { quantity: l.quantity }), critical: true })) }, key.current);
      key.current = newIdempotencyKey();
      void qc.invalidateQueries({ queryKey: keys.estimates });
      void qc.invalidateQueries({ queryKey: keys.readiness });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const sync = async (id: string, revision: number) => {
    setError(null);
    try {
      await curb.syncEstimate(projectId, id, revision);
      void qc.invalidateQueries({ queryKey: keys.estimates });
    } catch (e) {
      setError(e);
    }
  };

  const items = list.data?.items ?? [];
  return (
    <Panel title="Estimate" id="estimate">
      {list.error && <ErrorNotice error={list.error} onRetry={() => void list.refetch()} />}
      {items.map((e) => (
        <article key={e.id} className="curb-estimate-card">
          <EstimateView estimate={e} />
          <div className="curb-row">
            {e.stale && (
              <Button size="sm" onClick={() => void sync(e.id, e.revision)}>
                Reprice with current inputs
              </Button>
            )}
            <ButtonLink href={`/curb/projects/${projectId}/estimates/${e.id}`} variant="secondary">
              Open estimate
            </ButtonLink>
          </div>
        </article>
      ))}
      <details open={items.length === 0}>
        <summary>New estimate from recorded measurements</summary>
        <p className="web-muted">Each line takes its quantity from a recorded measurement (for example cut_length) or an explicit quantity. Unknown measurements are never priced as zero.</p>
        {lines.map((l, i) => (
          <div key={i} className="curb-row">
            <Field label="Price item code">
              <TextInput value={l.code} onChange={(ev) => setLines(lines.map((x, j) => (j === i ? { ...x, code: ev.target.value.toUpperCase() } : x)))} />
            </Field>
            <Field label="Quantity from measurement">
              <TextInput value={l.quantityKey} onChange={(ev) => setLines(lines.map((x, j) => (j === i ? { ...x, quantityKey: ev.target.value, quantity: '' } : x)))} />
            </Field>
            <Field label="or explicit quantity">
              <TextInput inputMode="decimal" value={l.quantity} onChange={(ev) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: ev.target.value, quantityKey: '' } : x)))} />
            </Field>
          </div>
        ))}
        <div className="curb-row">
          <Button size="sm" variant="ghost" onClick={() => setLines([...lines, { code: '', quantityKey: '', quantity: '1' }])}>
            Add line
          </Button>
          <Button disabled={!valid || !session.can('estimate:write')} loading={busy} onClick={() => void create()}>
            Price estimate
          </Button>
        </div>
      </details>
      {error !== null && <ErrorNotice error={error} title="Estimate not priced" />}
    </Panel>
  );
}
