'use client';

import {
  ADDENDUM_CONTROL_GATES,
  ADDENDUM_COUNTS,
  ENTERPRISE_CONTROL_MODULES,
  ENTERPRISE_DOMAINS,
  ENTERPRISE_WORK_PACKAGES,
  domainLabel,
  findWorkPackage,
  nextLifecycleStage,
  workPackageFieldKey,
  workPackageLabel,
  type EnterpriseDomainKey,
  type EnterpriseWorkPackage,
} from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { BlueprintRecords, BlueprintSummary, type BlueprintRecordType } from './blueprintSchemas';
import { SuiteStatus } from './schemas';
import { EnterpriseModuleNav } from './EnterpriseModuleNav';
import { PANELS } from './modules';

type Tab = 'packages' | 'controls';
type GateFilter = 'all' | '1' | '2' | '3' | '4';

const OPERABLE = ENTERPRISE_WORK_PACKAGES.filter((pkg) => pkg.specification !== 'indexed');
const BLUEPRINT_BREADCRUMB = PANELS.find((panel) => panel.id === 'blueprint');
const ADDENDUM_SUMMARY = `${ADDENDUM_COUNTS.featureAreas} control-level feature areas (${ADDENDUM_COUNTS.featureControlPages} control pages) from the addendum`;

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function fieldLabel(pkg: EnterpriseWorkPackage, key: string): string {
  return pkg.fields.find((label) => workPackageFieldKey(label) === key) ?? key;
}

function specLabel(pkg: EnterpriseWorkPackage): string {
  if (pkg.specification === 'core') return 'Core specification';
  if (pkg.specification === 'expansion') return 'Expanded appendix';
  return 'Indexed only';
}

export function EnterpriseBlueprintView() {
  const { api } = useApi();
  const session = useSession();
  const prefix = orgKey(session.orgId, 'enterprise');
  const [tab, setTab] = useState<Tab>('packages');
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<'all' | EnterpriseDomainKey>('all');
  const [gate, setGate] = useState<GateFilter>('all');
  const [selectedCode, setSelectedCode] = useState('001');
  const [controlKey, setControlKey] = useState(ENTERPRISE_CONTROL_MODULES[0]?.key ?? '');
  const [busyRecord, setBusyRecord] = useState('');
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Same query key as /enterprise, so the activation state is shared and never fetched twice.
  const status = useQuery({
    queryKey: [...prefix, 'status'],
    queryFn: () => api.get('/v1/enterprise/status', { schema: SuiteStatus }),
  });
  const enabled = status.data?.enabled === true;
  const summary = useQuery({
    queryKey: [...prefix, 'blueprint'],
    queryFn: () => api.get('/v1/enterprise/blueprint', { schema: BlueprintSummary }),
    enabled,
  });
  const selected = findWorkPackage(selectedCode) ?? ENTERPRISE_WORK_PACKAGES[0]!;
  const records = useQuery({
    queryKey: [...prefix, 'blueprint', selected.code],
    queryFn: () =>
      api.get('/v1/enterprise/blueprint/' + selected.code + '/records', {
        schema: BlueprintRecords,
      }),
    enabled: enabled && selected.specification !== 'indexed',
  });

  const counts = useMemo(
    () => new Map((summary.data?.byPackage ?? []).map((row) => [row.packageCode, row.total])),
    [summary.data],
  );
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return ENTERPRISE_WORK_PACKAGES.filter((pkg) => {
      if (domain !== 'all' && pkg.domain !== domain) return false;
      if (gate !== 'all' && String(pkg.gate) !== gate) return false;
      if (!text) return true;
      return `${pkg.code} ${pkg.title} ${pkg.owner}`.toLowerCase().includes(text);
    });
  }, [domain, gate, query]);

  const refresh = async () => {
    if (!enabled) {
      await status.refetch();
      return;
    }
    await Promise.all([summary.refetch(), records.refetch()]);
  };

  const enableSuite = async () => {
    setEnabling(true);
    setError('');
    setNotice('');
    try {
      await api.put('/v1/enterprise/status', { enabled: true });
      await status.refetch();
      setNotice('Enterprise Suite enabled. Records are now available.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorHint(cause));
    } finally {
      setEnabling(false);
    }
  };

  const setRecordStatus = async (record: BlueprintRecordType, next: string) => {
    if (next === record.status) return;
    setBusyRecord(record.id);
    setError('');
    setNotice('');
    try {
      await api.patch(
        '/v1/enterprise/blueprint/records/' + record.id,
        { status: next },
        { ifMatch: record.revision },
      );
      await refresh();
      setNotice(`Record moved to ${workPackageLabel(next)}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorHint(cause));
    } finally {
      setBusyRecord('');
    }
  };

  const controlModule =
    ENTERPRISE_CONTROL_MODULES.find((module) => module.key === controlKey) ??
    ENTERPRISE_CONTROL_MODULES[0]!;

  return (
    <main className="enterprise-suite">
      <div className="enterprise-hero">
        <div className="enterprise-kicker">FIELD PRO // ENTERPRISE BLUEPRINT</div>
        <h1>Enterprise operating blueprint</h1>
        <p>
          {ENTERPRISE_WORK_PACKAGES.length} work packages, {ENTERPRISE_DOMAINS.length} domains and{' '}
          {ADDENDUM_SUMMARY}. Each specified package is a working, tenant-scoped record workspace
          with its documented fields and lifecycle. Existing roofing, curb, billing and plumbing
          routes are unchanged.
        </p>
        <a href="/roof" className="enterprise-back">
          ← Return to Roofing Mode
        </a>
      </div>

      <EnterpriseModuleNav area="blueprint" />

      {status.isPending && (
        <div className="enterprise-panel">Loading company Enterprise Suite status…</div>
      )}
      {status.error && (
        <div className="enterprise-error" role="alert">
          Cannot load suite: {errorHint(status.error)}
        </div>
      )}
      {status.data && !status.data.enabled && (
        <section className="enterprise-panel" aria-label="Enterprise Suite activation">
          <h2>Commercial Suite is disabled for this company</h2>
          <p>
            Opt-in is required. No existing roofing settings or data are changed by enabling it. The
            blueprint catalog stays readable; records start once the suite is enabled.
          </p>
          {status.data.canManage ? (
            <button type="button" disabled={enabling} onClick={() => void enableSuite()}>
              {enabling ? 'Enabling…' : 'Enable isolated Enterprise Suite'}
            </button>
          ) : (
            <p>Ask your organization owner or administrator to enable this add-on.</p>
          )}
        </section>
      )}

      {enabled && summary.isPending && (
        <div className="enterprise-panel">Loading blueprint records…</div>
      )}
      {enabled && summary.error && (
        <div className="enterprise-error" role="alert">
          Cannot load blueprint records: {errorHint(summary.error)}
        </div>
      )}

      <section className="enterprise-kpis blueprint-kpis" aria-label="Blueprint coverage">
        <div>
          <span>Work packages</span>
          <strong>{ENTERPRISE_WORK_PACKAGES.length}</strong>
        </div>
        <div>
          <span>Operable specifications</span>
          <strong>{OPERABLE.length}</strong>
        </div>
        <div>
          <span>Control modules</span>
          <strong>{ADDENDUM_COUNTS.featureAreas}</strong>
        </div>
        <div>
          <span>Records in this company</span>
          <strong>{enabled ? (summary.data?.totalRecords ?? 0) : '—'}</strong>
        </div>
      </section>

      <div className="blueprint-tabs" role="tablist" aria-label="Blueprint views">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'packages'}
          className={tab === 'packages' ? 'blueprint-tab blueprint-tab--active' : 'blueprint-tab'}
          onClick={() => setTab('packages')}
        >
          Work packages
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'controls'}
          className={tab === 'controls' ? 'blueprint-tab blueprint-tab--active' : 'blueprint-tab'}
          onClick={() => setTab('controls')}
        >
          Control-level addendum
        </button>
      </div>

      {notice && (
        <p className="enterprise-success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="enterprise-error" role="alert">
          {error}
        </p>
      )}

      {tab === 'packages' && (
        <section className="blueprint-layout" aria-label="Work package catalog">
          <aside className="enterprise-panel blueprint-catalog">
            <div className="blueprint-filters">
              <label>
                Search
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Code, title or owner"
                />
              </label>
              <label>
                Domain
                <select
                  value={domain}
                  onChange={(event) => setDomain(event.target.value as 'all' | EnterpriseDomainKey)}
                >
                  <option value="all">All domains</option>
                  {ENTERPRISE_DOMAINS.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Release gate
                <select
                  value={gate}
                  onChange={(event) => setGate(event.target.value as GateFilter)}
                >
                  <option value="all">All gates</option>
                  <option value="1">Gate 1 · pilot</option>
                  <option value="2">Gate 2 · operations</option>
                  <option value="3">Gate 3 · mobile & enterprise</option>
                  <option value="4">Gate 4 · expansion</option>
                </select>
              </label>
            </div>
            <p className="enterprise-muted" role="status">
              {filtered.length} package{filtered.length === 1 ? '' : 's'} shown
            </p>
            <div className="blueprint-package-list">
              {filtered.map((pkg) => {
                const total = counts.get(pkg.code) ?? 0;
                return (
                  <button
                    key={pkg.code}
                    type="button"
                    aria-pressed={pkg.code === selected.code}
                    className={
                      pkg.code === selected.code
                        ? 'blueprint-package blueprint-package--active'
                        : 'blueprint-package'
                    }
                    onClick={() => {
                      setSelectedCode(pkg.code);
                      setError('');
                      setNotice('');
                    }}
                  >
                    <span className="blueprint-code">{pkg.code}</span>
                    <span className="blueprint-package-body">
                      <strong>{pkg.title}</strong>
                      <small>
                        {domainLabel(pkg.domain)} · {pkg.owner}
                      </small>
                    </span>
                    {enabled && (
                      <span
                        className={
                          total ? 'blueprint-count blueprint-count--used' : 'blueprint-count'
                        }
                      >
                        {total}
                      </span>
                    )}
                  </button>
                );
              })}
              {filtered.length === 0 && (
                <p className="enterprise-empty">No package matches those filters.</p>
              )}
            </div>
          </aside>

          <div className="blueprint-workspace">
            <section className="enterprise-panel">
              <div className="blueprint-detail-head">
                <div>
                  <span className="enterprise-kicker">
                    WP {selected.code} / {domainLabel(selected.domain)}
                  </span>
                  <h2>{selected.title}</h2>
                  <p>
                    {selected.owner} · Suggested gate {selected.gate} · {specLabel(selected)}
                  </p>
                </div>
                <span className={`blueprint-badge blueprint-badge--${selected.specification}`}>
                  {selected.specification === 'indexed' ? 'Not operable yet' : 'Operable'}
                </span>
              </div>

              {selected.specification === 'indexed' ? (
                <div className="blueprint-notice">
                  <strong>Detailed specification not in the supplied extract</strong>
                  <p>
                    This package is indexed in the expanded work-package index (WP 123–157), but its
                    five detail pages fall beyond the supplied blueprint text. It is listed so the
                    catalog is complete; records stay disabled until those pages are added. The
                    control-level addendum below covers the related accounting, bidding, wallet,
                    scheduling and integration workflows.
                  </p>
                </div>
              ) : (
                <>
                  <div className="blueprint-spec-grid">
                    <div>
                      <h3>Lifecycle</h3>
                      <div className="blueprint-chip-row">
                        {selected.lifecycle.map((stage, index) => (
                          <span key={stage} className="blueprint-chip">
                            <span className="blueprint-chip-index">{index + 1}</span>
                            {workPackageLabel(stage)}
                          </span>
                        ))}
                      </div>
                      <h3>Fields and validation</h3>
                      <ul className="blueprint-list">
                        {selected.fields.map((field) => (
                          <li key={field}>{field}</li>
                        ))}
                      </ul>
                      <h3>Actions</h3>
                      <ul className="blueprint-list">
                        {selected.actions.map((action) => (
                          <li key={action}>{action}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h3>Exception path</h3>
                      <p className="blueprint-exception">{selected.exception}</p>
                      <h3>Proposed tables</h3>
                      <div className="blueprint-chip-row">
                        {selected.tables.map((table) => (
                          <code key={table} className="blueprint-table-chip">
                            {table}
                          </code>
                        ))}
                      </div>
                      <h3>Operating note</h3>
                      <p className="enterprise-muted">
                        Records are tenant-scoped, revision-checked and audited. Lifecycle changes
                        are validated against the stages above; there is no free-text status.
                      </p>
                    </div>
                  </div>

                  <h3 className="blueprint-records-heading">
                    Records{' '}
                    <span>
                      {enabled ? `${records.data?.items.length ?? 0} shown` : 'suite disabled'}
                    </span>
                  </h3>
                  {!enabled && (
                    <p className="enterprise-muted">
                      Enable the Enterprise Suite above to load and create records. The
                      specification stays readable without it.
                    </p>
                  )}
                  {enabled && records.error && (
                    <p className="enterprise-error" role="alert">
                      Records could not load: {errorHint(records.error)}
                    </p>
                  )}
                  {enabled && records.data?.items.length === 0 && (
                    <p className="enterprise-empty">
                      No records yet. Create the first {selected.title.toLowerCase()} record below.
                    </p>
                  )}
                  {enabled && !!records.data?.items.length && (
                    <div className="blueprint-records">
                      {records.data.items.map((record) => (
                        <article key={record.id} className="blueprint-record">
                          <div className="blueprint-record-head">
                            <strong>{record.title}</strong>
                            <span
                              className={`enterprise-status enterprise-status--${record.status}`}
                            >
                              {workPackageLabel(record.status)}
                            </span>
                          </div>
                          <small>
                            Updated {formatWhen(record.updatedAt)} · revision {record.revision}
                          </small>
                          {Object.keys(record.fields).length > 0 && (
                            <dl className="blueprint-fields">
                              {Object.entries(record.fields)
                                .slice(0, 6)
                                .map(([key, value]) => (
                                  <div key={key}>
                                    <dt>{fieldLabel(selected, key)}</dt>
                                    <dd>{value}</dd>
                                  </div>
                                ))}
                            </dl>
                          )}
                          {record.notes && <p className="enterprise-muted">{record.notes}</p>}
                          <div className="blueprint-record-actions">
                            <label>
                              Stage
                              <select
                                value={record.status}
                                disabled={!!busyRecord || !session.can('job:write')}
                                onChange={(event) =>
                                  void setRecordStatus(record, event.target.value)
                                }
                                aria-label={`Change stage for ${record.title}`}
                              >
                                {selected.lifecycle.map((stage) => (
                                  <option key={stage} value={stage}>
                                    {workPackageLabel(stage)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {nextLifecycleStage(selected, record.status) && (
                              <button
                                type="button"
                                className="enterprise-quiet"
                                disabled={!!busyRecord || !session.can('job:write')}
                                onClick={() =>
                                  void setRecordStatus(
                                    record,
                                    nextLifecycleStage(selected, record.status)!,
                                  )
                                }
                              >
                                Advance to{' '}
                                {workPackageLabel(nextLifecycleStage(selected, record.status)!)}
                              </button>
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                  )}

                  {enabled && (
                    <BlueprintRecordForm key={selected.code} pkg={selected} onSaved={refresh} />
                  )}
                </>
              )}
            </section>
          </div>
        </section>
      )}

      {tab === 'controls' && (
        <section className="blueprint-controls" aria-label="Control-level addendum">
          <aside className="enterprise-panel blueprint-control-list">
            <h2>Feature areas</h2>
            <p className="enterprise-muted">
              {ADDENDUM_COUNTS.featureAreas} areas · {ADDENDUM_COUNTS.featureControlPages}{' '}
              feature-control pages
            </p>
            {ENTERPRISE_CONTROL_MODULES.map((module) => (
              <button
                key={module.key}
                type="button"
                aria-pressed={module.key === controlModule.key}
                className={
                  module.key === controlModule.key
                    ? 'blueprint-package blueprint-package--active'
                    : 'blueprint-package'
                }
                onClick={() => setControlKey(module.key)}
              >
                <span className="blueprint-package-body">
                  <strong>{module.title}</strong>
                  <small>{module.workPackageCodes.length} linked work packages</small>
                </span>
              </button>
            ))}
          </aside>
          <div className="blueprint-workspace">
            <section className="enterprise-panel">
              <span className="enterprise-kicker">CONTROL-LEVEL ADDENDUM v4.1</span>
              <h2>{controlModule.title}</h2>
              <p>{controlModule.summary}</p>

              <h3>Routes</h3>
              <div className="blueprint-chip-row">
                {controlModule.routes.map((route) => (
                  <code key={route} className="blueprint-table-chip">
                    {route}
                  </code>
                ))}
              </div>

              <h3>Dashboard metrics</h3>
              <ul className="blueprint-list">
                {controlModule.kpis.map((kpi) => (
                  <li key={kpi}>{kpi}</li>
                ))}
              </ul>

              <h3>Entities</h3>
              <div className="blueprint-chip-row">
                {controlModule.entities.map((entity) => (
                  <code key={entity} className="blueprint-table-chip">
                    {entity}
                  </code>
                ))}
              </div>

              <h3>Eighteen control gates</h3>
              <ol className="blueprint-gates">
                {ADDENDUM_CONTROL_GATES.map((gateName) => (
                  <li key={gateName}>{gateName}</li>
                ))}
              </ol>

              <h3>Linked work packages</h3>
              <div className="blueprint-chip-row">
                {controlModule.workPackageCodes.map((code) => {
                  const pkg = findWorkPackage(code);
                  if (!pkg) return null;
                  return (
                    <button
                      key={code}
                      type="button"
                      className="blueprint-link"
                      onClick={() => {
                        setSelectedCode(code);
                        setTab('packages');
                      }}
                    >
                      {code} · {pkg.title}
                    </button>
                  );
                })}
              </div>

              <p className="enterprise-muted">
                Addendum scope: {ADDENDUM_COUNTS.controlMatrixPages} granular control matrices,{' '}
                {ADDENDUM_COUNTS.sharedControlPages} shared UI/engineering control pages and{' '}
                {ADDENDUM_COUNTS.crossModuleScenarios} cross-module scenarios. Each gate is
                satisfied by operating records plus acceptance evidence; a rendered screen alone is
                not completion.
              </p>
            </section>
          </div>
        </section>
      )}

      <p className="enterprise-muted blueprint-footnote">
        {BLUEPRINT_BREADCRUMB?.description}. Source: FieldPro Enterprise Developer Blueprint v4 and
        Control-Level Addendum v4.1. Proposed tables, routes and thresholds remain implementation
        decisions until reviewed in an architecture decision record.
      </p>
    </main>
  );
}

function BlueprintRecordForm({
  pkg,
  onSaved,
}: {
  pkg: EnterpriseWorkPackage;
  onSaved: () => Promise<void>;
}) {
  const { api } = useApi();
  const session = useSession();
  const [title, setTitle] = useState('');
  const [values, setValues] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setError('Give the record a short title.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const fields = Object.fromEntries(
        Object.entries(values)
          .map(([key, value]) => [key, value.trim()] as const)
          .filter(([, value]) => value.length > 0),
      );
      await api.post('/v1/enterprise/blueprint/' + pkg.code + '/records', {
        title: title.trim(),
        fields,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        clientRequestId: crypto.randomUUID(),
      });
      setTitle('');
      setValues({});
      setNotes('');
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorHint(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="blueprint-form" onSubmit={submit}>
      <h3>New record</h3>
      {error && (
        <p className="enterprise-error" role="alert">
          {error}
        </p>
      )}
      <label>
        Record title
        <input
          required
          minLength={2}
          maxLength={255}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={pkg.title}
        />
      </label>
      <div className="blueprint-form-fields">
        {pkg.fields.map((field) => {
          const key = workPackageFieldKey(field);
          return (
            <label key={key}>
              {field}
              <input
                value={values[key] ?? ''}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [key]: event.target.value }))
                }
                maxLength={2000}
              />
            </label>
          );
        })}
      </div>
      <label>
        Notes
        <textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={10000}
          placeholder="Decision, source revision or next action"
        />
      </label>
      <button type="submit" disabled={busy || !session.can('job:write')}>
        {busy ? 'Saving…' : 'Create record'}
      </button>
      {!session.can('job:write') && (
        <p className="enterprise-muted">Your role has read-only access.</p>
      )}
    </form>
  );
}
