'use client';

import {
  ENTERPRISE_LINK_KINDS,
  enterpriseLinkAllowedBetween,
  enterpriseLinkRule,
  workPackageLabel,
  type EnterpriseLinkKind,
} from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { BlueprintLinks, BlueprintRecords, type BlueprintRecordType } from './blueprintSchemas';

export function BlueprintRecordLinks({
  record,
  onOpen,
  onChanged,
}: {
  record: BlueprintRecordType;
  onOpen: (packageCode: string, recordId: string) => void;
  onChanged: () => Promise<void>;
}) {
  const { api } = useApi();
  const session = useSession();
  const prefix = orgKey(session.orgId, 'enterprise');
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<EnterpriseLinkKind>('blocks');
  const [targetSearch, setTargetSearch] = useState('');
  const [targetId, setTargetId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const rule = enterpriseLinkRule(kind);

  const links = useQuery({
    queryKey: [...prefix, 'blueprint', 'links', record.id, record.revision],
    queryFn: () =>
      api.get('/v1/enterprise/blueprint/records/' + record.id + '/links', {
        schema: BlueprintLinks,
      }),
    enabled: open,
  });
  const targets = useQuery({
    queryKey: [...prefix, 'blueprint', 'link-targets', targetSearch.trim()],
    queryFn: () =>
      api.get('/v1/enterprise/blueprint/records', {
        schema: BlueprintRecords,
        query: { limit: 50, q: targetSearch.trim() || undefined },
      }),
    enabled: open,
  });

  const candidates = (targets.data?.items ?? []).filter(
    (candidate) =>
      candidate.id !== record.id &&
      enterpriseLinkAllowedBetween(kind, record.packageCode, candidate.packageCode) &&
      (!rule.requireSameProject ||
        !record.projectId ||
        !candidate.projectId ||
        record.projectId === candidate.projectId),
  );

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!targetId) {
      setError('Choose a target record first.');
      return;
    }
    setBusy('create');
    setError('');
    try {
      await api.post('/v1/enterprise/blueprint/records/' + record.id + '/links', {
        kind,
        toRecordId: targetId,
        note: note.trim() || null,
      });
      await links.refetch();
      await onChanged();
      setTargetId('');
      setNote('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorHint(cause));
    } finally {
      setBusy('');
    }
  };

  const remove = async (linkId: string) => {
    setBusy(linkId);
    setError('');
    try {
      await api.delete('/v1/enterprise/blueprint/records/' + record.id + '/links/' + linkId);
      await links.refetch();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorHint(cause));
    } finally {
      setBusy('');
    }
  };

  const direct = links.data?.links ?? [];
  const upstream = links.data?.impact.upstream ?? [];
  const downstream = links.data?.impact.downstream ?? [];

  return (
    <details
      className="blueprint-record-links"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        Links &amp; dependencies
        {links.data
          ? ` · ${direct.length} direct · ${downstream.length} downstream · ${upstream.length} upstream`
          : ''}
      </summary>
      {open && (
        <div className="blueprint-link-panel">
          {error && (
            <p className="enterprise-error" role="alert">
              {error}
            </p>
          )}
          {links.isPending && <p className="enterprise-muted">Loading links…</p>}
          {!links.isPending && links.error && (
            <p className="enterprise-error" role="alert">
              Links could not load: {errorHint(links.error)}
            </p>
          )}

          {!links.isPending && !links.error && direct.length === 0 && (
            <p className="enterprise-empty">
              No links yet. Connect this record to another work package below.
            </p>
          )}
          {direct.length > 0 && (
            <ul className="blueprint-link-list">
              {direct.map((link) => {
                const linkRule = enterpriseLinkRule(link.kind);
                const label =
                  link.direction === 'outgoing' ? linkRule.label : linkRule.inverseLabel;
                return (
                  <li key={link.id} className="blueprint-link-row">
                    <span className={`blueprint-link-kind blueprint-link-kind--${link.kind}`}>
                      {label}
                    </span>
                    <button
                      type="button"
                      className="blueprint-link"
                      onClick={() => onOpen(link.record.packageCode, link.record.id)}
                    >
                      {link.record.packageCode} · {link.record.title}
                    </button>
                    <span className="enterprise-muted">{workPackageLabel(link.record.status)}</span>
                    {link.direction === 'outgoing' && session.can('job:write') && (
                      <button
                        type="button"
                        className="enterprise-quiet"
                        disabled={busy === link.id}
                        onClick={() => void remove(link.id)}
                      >
                        {busy === link.id ? 'Removing…' : 'Remove'}
                      </button>
                    )}
                    {link.note && <small>{link.note}</small>}
                  </li>
                );
              })}
            </ul>
          )}

          {!links.isPending && !links.error && (
            <section className="blueprint-impact" aria-label="Blocking impact">
              <h4>Blocking impact</h4>
              <p className="enterprise-muted">
                Downstream records are blocked by this record; upstream records block it.
              </p>
              <div className="blueprint-impact-grid">
                <div>
                  <strong>Downstream · {downstream.length}</strong>
                  {downstream.length === 0 ? (
                    <p className="enterprise-muted">No downstream records.</p>
                  ) : (
                    <ul>
                      {downstream.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="blueprint-link"
                            onClick={() => onOpen(item.packageCode, item.id)}
                          >
                            {item.packageCode} · {item.title}
                          </button>
                          <span className="enterprise-muted">{workPackageLabel(item.status)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <strong>Upstream · {upstream.length}</strong>
                  {upstream.length === 0 ? (
                    <p className="enterprise-muted">No upstream blockers.</p>
                  ) : (
                    <ul>
                      {upstream.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="blueprint-link"
                            onClick={() => onOpen(item.packageCode, item.id)}
                          >
                            {item.packageCode} · {item.title}
                          </button>
                          <span className="enterprise-muted">{workPackageLabel(item.status)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </section>
          )}

          {session.can('job:write') ? (
            <form className="blueprint-link-form" onSubmit={create}>
              <h4>Add typed link</h4>
              <p className="enterprise-muted">{rule.description}</p>
              <div className="blueprint-form-fields">
                <label>
                  Relationship
                  <select
                    value={kind}
                    onChange={(event) => {
                      setKind(event.target.value as EnterpriseLinkKind);
                      setTargetId('');
                    }}
                  >
                    {ENTERPRISE_LINK_KINDS.map((value) => (
                      <option key={value} value={value}>
                        {enterpriseLinkRule(value).label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Find target
                  <input
                    type="search"
                    value={targetSearch}
                    onChange={(event) => {
                      setTargetSearch(event.target.value);
                      setTargetId('');
                    }}
                    placeholder="Search title or work package"
                  />
                </label>
              </div>
              <label>
                Target record
                <select
                  required
                  value={targetId}
                  onChange={(event) => setTargetId(event.target.value)}
                  disabled={targets.isPending}
                >
                  <option value="">
                    {targets.isPending
                      ? 'Loading records…'
                      : candidates.length
                        ? 'Choose a record…'
                        : 'No eligible records found'}
                  </option>
                  {candidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.packageCode} · {candidate.title} ·{' '}
                      {workPackageLabel(candidate.status)}
                    </option>
                  ))}
                </select>
              </label>
              {targets.error && (
                <p className="enterprise-error" role="alert">
                  Target records could not load: {errorHint(targets.error)}
                </p>
              )}
              <label>
                Note
                <input
                  value={note}
                  maxLength={500}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Why these records belong together"
                />
              </label>
              <button type="submit" disabled={busy === 'create' || !targetId}>
                {busy === 'create' ? 'Linking…' : 'Link records'}
              </button>
            </form>
          ) : (
            <p className="enterprise-muted">Your role has read-only access to links.</p>
          )}
        </div>
      )}
    </details>
  );
}
