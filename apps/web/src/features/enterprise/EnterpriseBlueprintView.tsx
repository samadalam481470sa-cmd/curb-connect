'use client';

import {
  ADDENDUM_COUNTS,
  ADDENDUM_CROSS_MODULE_TOPICS,
  ADDENDUM_SHARED_CONTROL_TOPICS,
  ENTERPRISE_CONTROL_MODULES,
  ENTERPRISE_DOMAINS,
  ENTERPRISE_WORK_PACKAGES,
  addendumPageRanges,
  domainLabel,
  enterpriseFieldDefinition,
  enterpriseFieldSchema,
  findWorkPackage,
  getRoute,
  nextLifecycleStage,
  workPackageFieldKey,
  workPackageLabel,
  workPackagePages,
  type EnterpriseDomainKey,
  type EnterpriseFieldDefinition,
  type EnterpriseWorkPackage,
} from '@fieldline/contracts';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import {
  BlueprintExceptions,
  BlueprintRecords,
  BlueprintSummary,
  BlueprintTeamMembers,
  type BlueprintRecordType,
} from './blueprintSchemas';
import { ProjectList, SuiteStatus } from './schemas';
import { BlueprintExceptionInbox } from './BlueprintExceptionInbox';
import { BlueprintRecordWorkflow } from './BlueprintRecordWorkflow';
import { BlueprintRecordLinks } from './BlueprintRecordLinks';
import { BlueprintProjectPlaybook } from './BlueprintProjectPlaybook';
import { BlueprintControlCompliance } from './BlueprintControlCompliance';
import { EnterpriseModuleNav } from './EnterpriseModuleNav';
import { PANELS } from './modules';

const controlWorkspaceLinks = new Map<string, { href: string; label: string }>([
  [
    getRoute('enterprise.changeOrders').path,
    { href: getRoute('enterprise.changeOrders').path, label: 'Open change order queue' },
  ],
  [
    getRoute('enterprise.scheduling').path,
    { href: getRoute('enterprise.scheduling').path, label: 'Open construction schedule' },
  ],
  [
    getRoute('enterprise.bidding').path,
    { href: getRoute('enterprise.bidding').path, label: 'Open vendor bidding' },
  ],
  ['/enterprise/documents', { href: '/enterprise/vault', label: 'Open document vault' }],
]);

type Tab = 'packages' | 'playbook' | 'inbox' | 'controls';
type GateFilter = 'all' | '1' | '2' | '3' | '4';

const OPERABLE = ENTERPRISE_WORK_PACKAGES.filter((pkg) => pkg.specification !== 'indexed');
const BLUEPRINT_BREADCRUMB = PANELS.find((panel) => panel.id === 'blueprint');
const ADDENDUM_SUMMARY = `${ADDENDUM_COUNTS.featureAreas} control-level feature areas (${ADDENDUM_COUNTS.featureControlPages} control pages) from the addendum`;
const MONEY_FORMAT = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function formatWhen(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function fieldLabel(pkg: EnterpriseWorkPackage, key: string): string {
  return (
    enterpriseFieldDefinition(pkg.code, key)?.label ??
    pkg.fields.find((label) => workPackageFieldKey(label) === key) ??
    key
  );
}

function formatFieldValue(
  pkg: EnterpriseWorkPackage,
  key: string,
  value: string | number | boolean | null,
): string {
  const field = enterpriseFieldDefinition(pkg.code, key);
  if (field?.type === 'money' && typeof value === 'number') return MONEY_FORMAT.format(value / 100);
  if (field?.type === 'computed' && field.format === 'money' && typeof value === 'number')
    return MONEY_FORMAT.format(value / 100);
  if (field?.type === 'computed' && field.format === 'percent' && typeof value === 'number')
    return `${value}%`;
  if (field?.type === 'enum')
    return field.options.find((option) => option.value === value)?.label ?? String(value);
  if (value === null) return '—';
  return String(value);
}

function orderedFieldEntries(
  pkg: EnterpriseWorkPackage,
  fields: Record<string, string | number>,
): [string, string | number][] {
  const schema = enterpriseFieldSchema(pkg.code);
  const order = new Map(schema?.fields.map((field, index) => [field.key, index]));
  return Object.entries(fields).sort(
    ([left], [right]) => (order.get(left) ?? 999) - (order.get(right) ?? 999),
  );
}

function specLabel(pkg: EnterpriseWorkPackage): string {
  if (pkg.specification === 'core') return 'Core specification';
  if (pkg.specification === 'expansion') return 'Expanded appendix';
  return 'Indexed only';
}

export function EnterpriseBlueprintView({ initialCode }: { initialCode: string }) {
  const { api } = useApi();
  const session = useSession();
  const prefix = orgKey(session.orgId, 'enterprise');
  const [tab, setTab] = useState<Tab>('packages');
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState<'all' | EnterpriseDomainKey>('all');
  const [gate, setGate] = useState<GateFilter>('all');
  const [selectedCode, setSelectedCode] = useState(initialCode);
  const [controlKey, setControlKey] = useState(ENTERPRISE_CONTROL_MODULES[0]?.key ?? '');
  const [busyRecord, setBusyRecord] = useState('');
  const [focusRecordId, setFocusRecordId] = useState('');
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
  const sourcePages = workPackagePages(selected);
  const records = useQuery({
    queryKey: [...prefix, 'blueprint', selected.code],
    queryFn: () =>
      api.get('/v1/enterprise/blueprint/' + selected.code + '/records', {
        schema: BlueprintRecords,
      }),
    enabled: enabled && selected.specification !== 'indexed',
  });
  const members = useQuery({
    queryKey: [...prefix, 'blueprint-members'],
    queryFn: () =>
      api.get('/v1/team/members?limit=100&status=active', { schema: BlueprintTeamMembers }),
    enabled,
  });
  const exceptions = useQuery({
    queryKey: [...prefix, 'blueprint', 'exceptions'],
    queryFn: () => api.get('/v1/enterprise/blueprint/exceptions', { schema: BlueprintExceptions }),
    enabled,
  });

  useEffect(() => {
    if (!focusRecordId) return;
    document
      .getElementById(`blueprint-record-${focusRecordId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusRecordId, records.data]);

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
    await Promise.all([summary.refetch(), records.refetch(), exceptions.refetch()]);
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

  const openRecord = (code: string, recordId: string) => {
    setSelectedCode(code);
    setFocusRecordId(recordId);
    setTab('packages');
    setError('');
    setNotice('');
  };

  const openPackage = (code: string) => {
    setSelectedCode(code);
    setFocusRecordId('');
    setTab('packages');
    setError('');
    setNotice('');
  };

  const controlModule =
    ENTERPRISE_CONTROL_MODULES.find((module) => module.key === controlKey) ??
    ENTERPRISE_CONTROL_MODULES[0]!;
  const controlPages = addendumPageRanges(controlModule.key);

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
          <span>Packages with record tracking</span>
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
          aria-selected={tab === 'playbook'}
          className={tab === 'playbook' ? 'blueprint-tab blueprint-tab--active' : 'blueprint-tab'}
          onClick={() => setTab('playbook')}
        >
          Project playbook
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'inbox'}
          className={tab === 'inbox' ? 'blueprint-tab blueprint-tab--active' : 'blueprint-tab'}
          onClick={() => setTab('inbox')}
        >
          Exception inbox
          {enabled && !!exceptions.data?.counts.total && (
            <span className="blueprint-tab-count">{exceptions.data.counts.total}</span>
          )}
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
                      setFocusRecordId('');
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
                  {selected.specification === 'indexed' ? 'Index entry' : 'Record tracking'}
                </span>
              </div>

              {selected.specification === 'indexed' ? (
                <div className="blueprint-notice">
                  <strong>Detailed specification pending</strong>
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
                      <h3>Specified actions</h3>
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
                      <h3>
                        Blueprint pages {sourcePages.first}–{sourcePages.last}
                      </h3>
                      <p className="enterprise-muted">
                        Use these tenant-scoped records to track work and evidence. Use the relevant
                        operating module for business transactions and external actions.
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
                        <article
                          key={record.id}
                          id={`blueprint-record-${record.id}`}
                          className={
                            record.id === focusRecordId
                              ? 'blueprint-record blueprint-record--focus'
                              : 'blueprint-record'
                          }
                        >
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
                          <div className="blueprint-record-meta">
                            <span>Owner: {record.ownerName ?? 'Unassigned'}</span>
                            <span>Due: {record.dueOn ?? '—'}</span>
                            <span>SLA: {record.slaHours ? `${record.slaHours}h` : '—'}</span>
                            {record.blockedReason && (
                              <span className="blueprint-record-blocked">
                                Blocked: {record.blockedReason}
                              </span>
                            )}
                          </div>
                          {Object.keys(record.fields).length > 0 && (
                            <dl className="blueprint-fields">
                              {orderedFieldEntries(selected, record.fields)
                                .slice(0, 12)
                                .map(([key, value]) => (
                                  <div key={key}>
                                    <dt>{fieldLabel(selected, key)}</dt>
                                    <dd>{formatFieldValue(selected, key, value)}</dd>
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
                          <BlueprintRecordWorkflow
                            key={`${record.id}:${record.revision}`}
                            record={record}
                            members={members.data?.items ?? []}
                            onSaved={async () => {
                              await refresh();
                              setNotice('Workflow saved.');
                            }}
                          />
                          <BlueprintRecordLinks
                            record={record}
                            onOpen={openRecord}
                            onChanged={refresh}
                          />
                        </article>
                      ))}
                    </div>
                  )}

                  {enabled && (
                    <BlueprintRecordForm
                      key={selected.code}
                      pkg={selected}
                      members={members.data?.items ?? []}
                      membersPending={members.isPending}
                      onSaved={refresh}
                    />
                  )}
                </>
              )}
            </section>
          </div>
        </section>
      )}

      {tab === 'playbook' &&
        (enabled ? (
          <BlueprintProjectPlaybook onOpenRecord={openRecord} onOpenPackage={openPackage} />
        ) : (
          <section className="enterprise-panel" aria-label="Project playbook unavailable">
            <h2>Project playbook</h2>
            <p className="enterprise-muted">
              Enable the Enterprise Suite to build a phase-by-phase playbook for a project.
            </p>
          </section>
        ))}

      {tab === 'inbox' &&
        (enabled ? (
          <BlueprintExceptionInbox
            data={exceptions.data}
            isPending={exceptions.isPending}
            error={exceptions.error}
            members={members.data?.items ?? []}
            onOpen={openRecord}
            onChanged={refresh}
          />
        ) : (
          <section className="enterprise-panel" aria-label="Exception inbox unavailable">
            <h2>Exception inbox</h2>
            <p className="enterprise-muted">
              Enable the Enterprise Suite to collect overdue, blocked and SLA-breached records in
              one daily queue.
            </p>
          </section>
        ))}

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
                {controlModule.routes.map((route) => {
                  const workspace = controlWorkspaceLinks.get(route);
                  return workspace ? (
                    <a key={route} className="blueprint-table-chip" href={workspace.href}>
                      {workspace.label}
                    </a>
                  ) : (
                    <code key={route} className="blueprint-table-chip">
                      {route}
                    </code>
                  );
                })}
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

              <BlueprintControlCompliance
                moduleKey={controlModule.key}
                pageStart={controlPages?.featureStart ?? null}
                members={members.data?.items ?? []}
              />
              {controlPages && (
                <p className="enterprise-muted">
                  Action, list, settings, and form matrices · pp. {controlPages.matrixStart}–
                  {controlPages.matrixEnd}
                </p>
              )}

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
            <details className="enterprise-panel">
              <summary>Shared platform controls and cross-module scenarios</summary>
              <ol className="blueprint-list" aria-label="Shared platform control pages">
                {ADDENDUM_SHARED_CONTROL_TOPICS.map((topic, index) => (
                  <li key={topic}>
                    {topic} · p. {236 + index}
                  </li>
                ))}
              </ol>
              <ol className="blueprint-list" aria-label="Cross-module engineering pages">
                {ADDENDUM_CROSS_MODULE_TOPICS.map((topic, index) => (
                  <li key={topic}>
                    {topic} · p. {256 + index}
                  </li>
                ))}
              </ol>
            </details>
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
  members,
  membersPending,
  onSaved,
}: {
  pkg: EnterpriseWorkPackage;
  members: { userId: string; displayName: string }[];
  membersPending: boolean;
  onSaved: () => Promise<void>;
}) {
  const { api } = useApi();
  const session = useSession();
  const schema = enterpriseFieldSchema(pkg.code);
  const prefix = orgKey(session.orgId, 'enterprise');
  const needsProjects =
    schema?.fields.some((field) => field.type === 'reference' && field.target === 'project') ??
    false;
  const projects = useQuery({
    queryKey: [...prefix, 'projects'],
    queryFn: () => api.get('/v1/enterprise/projects', { schema: ProjectList }),
    enabled: needsProjects,
  });
  const recordReferenceFields: Extract<EnterpriseFieldDefinition, { type: 'reference' }>[] = schema
    ? schema.fields.filter(
        (field): field is Extract<EnterpriseFieldDefinition, { type: 'reference' }> =>
          field.type === 'reference' &&
          field.target === 'record' &&
          Boolean(field.packageCodes?.length),
      )
    : [];
  const recordQueries = useQueries({
    queries: recordReferenceFields.map((field) => ({
      queryKey: [...prefix, 'blueprint', field.packageCodes![0]],
      queryFn: () =>
        api.get(`/v1/enterprise/blueprint/${field.packageCodes![0]}/records?limit=100`, {
          schema: BlueprintRecords,
        }),
    })),
  });
  const recordOptions: Record<string, BlueprintRecordType[]> = {};
  const recordPending: Record<string, boolean> = {};
  recordReferenceFields.forEach((field, index) => {
    recordOptions[field.key] = recordQueries[index]?.data?.items ?? [];
    recordPending[field.key] = recordQueries[index]?.isPending ?? false;
  });
  const [title, setTitle] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [slaHours, setSlaHours] = useState('');
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
      const hours = slaHours.trim() === '' ? null : Number(slaHours);
      if (hours !== null && (!Number.isInteger(hours) || hours < 1 || hours > 8760)) {
        throw new Error('SLA hours must be a whole number from 1 to 8,760.');
      }
      const fields: Record<string, string | number> = {};
      if (schema) {
        for (const field of schema.fields) {
          if (field.type === 'computed') continue;
          const raw = (values[field.key] ?? '').trim();
          if (!raw) continue;
          if (field.type === 'money') {
            const amount = Number(raw);
            if (!Number.isFinite(amount)) throw new Error(`${field.label} must be a number.`);
            fields[field.key] = Math.round(amount * 100);
          } else if (field.type === 'number') {
            const amount = Number(raw);
            if (!Number.isFinite(amount)) throw new Error(`${field.label} must be a number.`);
            fields[field.key] = amount;
          } else {
            fields[field.key] = raw;
          }
        }
      } else {
        for (const [key, value] of Object.entries(values)) {
          const trimmed = value.trim();
          if (trimmed) fields[key] = trimmed;
        }
      }
      await api.post('/v1/enterprise/blueprint/' + pkg.code + '/records', {
        title: title.trim(),
        fields,
        ownerUserId: ownerUserId || null,
        dueOn: dueOn || null,
        slaHours: hours,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        clientRequestId: crypto.randomUUID(),
      });
      setTitle('');
      setOwnerUserId('');
      setDueOn('');
      setSlaHours('');
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
      <p className="enterprise-muted">
        Use approved reference IDs for credentials, payment accounts, or identity documents.
      </p>
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
        <label>
          Owner
          <select value={ownerUserId} onChange={(event) => setOwnerUserId(event.target.value)}>
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName}
              </option>
            ))}
          </select>
          {membersPending && <small className="enterprise-muted">Loading members…</small>}
        </label>
        <label>
          Due date
          <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
        </label>
        <label>
          SLA hours
          <input
            type="number"
            min={1}
            max={8760}
            step={1}
            value={slaHours}
            onChange={(event) => setSlaHours(event.target.value)}
            placeholder="e.g. 48"
          />
        </label>
      </div>
      <div className="blueprint-form-fields">
        {schema
          ? schema.fields.map((field) => (
              <BlueprintTypedFieldInput
                key={field.key}
                field={field}
                value={values[field.key] ?? ''}
                projects={projects.data?.items ?? []}
                members={members}
                recordOptions={recordOptions}
                projectsPending={projects.isPending}
                membersPending={membersPending}
                recordPending={recordPending}
                onChange={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
              />
            ))
          : pkg.fields.map((field) => {
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

function BlueprintTypedFieldInput({
  field,
  value,
  projects,
  members,
  recordOptions,
  projectsPending,
  membersPending,
  recordPending,
  onChange,
}: {
  field: EnterpriseFieldDefinition;
  value: string;
  projects: { id: string; name: string }[];
  members: { userId: string; displayName: string }[];
  recordOptions: Record<string, { id: string; title: string; status: string }[]>;
  projectsPending: boolean;
  membersPending: boolean;
  recordPending: Record<string, boolean>;
  onChange: (value: string) => void;
}) {
  if (field.type === 'computed') {
    return (
      <label>
        {field.label}
        <input readOnly value="Calculated on save" />
        <small className="enterprise-muted">Derived by the server from the other fields.</small>
      </label>
    );
  }
  if (field.type === 'enum') {
    return (
      <label>
        {field.label}
        <select
          required={field.required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select…</option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {field.help && <small className="enterprise-muted">{field.help}</small>}
      </label>
    );
  }
  if (field.type === 'reference' && field.target === 'project') {
    return (
      <label>
        {field.label}
        <select
          required={field.required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">
            {projectsPending
              ? 'Loading projects…'
              : projects.length
                ? 'Select a commercial project…'
                : 'No commercial projects yet'}
          </option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        {!projectsPending && projects.length === 0 && (
          <small className="enterprise-muted">
            Create a commercial project in the Enterprise overview first.
          </small>
        )}
      </label>
    );
  }
  if (field.type === 'reference' && field.target === 'record' && field.packageCodes?.length) {
    const options = recordOptions[field.key] ?? [];
    return (
      <label>
        {field.label}
        <select
          required={field.required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">
            {recordPending[field.key]
              ? 'Loading records…'
              : options.length
                ? 'Select a record…'
                : 'No matching records yet'}
          </option>
          {options.map((record) => (
            <option key={record.id} value={record.id}>
              {record.title} · {record.status}
            </option>
          ))}
        </select>
        <small className="enterprise-muted">
          References {field.packageCodes.join(' / ')} records.
        </small>
      </label>
    );
  }
  if (field.type === 'reference' && field.target === 'user') {
    return (
      <label>
        {field.label}
        <select
          required={field.required}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">
            {membersPending
              ? 'Loading members…'
              : members.length
                ? 'Select a team member…'
                : 'No active members'}
          </option>
          {members.map((member) => (
            <option key={member.userId} value={member.userId}>
              {member.displayName}
            </option>
          ))}
        </select>
      </label>
    );
  }

  const inputType =
    field.type === 'date'
      ? 'date'
      : field.type === 'money' || field.type === 'number'
        ? 'number'
        : 'text';
  const min =
    field.type === 'money'
      ? field.minMinor !== undefined
        ? field.minMinor / 100
        : undefined
      : field.type === 'number'
        ? field.min
        : field.type === 'date'
          ? field.min
          : undefined;
  const max =
    field.type === 'money'
      ? field.maxMinor !== undefined
        ? field.maxMinor / 100
        : undefined
      : field.type === 'number'
        ? field.max
        : field.type === 'date'
          ? field.max
          : undefined;
  const step = field.type === 'money' ? 0.01 : field.type === 'number' ? field.step : undefined;
  const placeholder =
    field.type === 'reference'
      ? field.target === 'project'
        ? 'Project UUID'
        : field.target === 'user'
          ? 'User UUID'
          : 'Record UUID'
      : undefined;

  return (
    <label>
      {field.label}
      {field.type === 'money' ? ' (USD)' : ''}
      <input
        type={inputType}
        required={field.required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        min={min}
        max={max}
        step={step}
        maxLength={field.type === 'text' ? field.maxLength : undefined}
        placeholder={placeholder}
      />
      {field.help && <small className="enterprise-muted">{field.help}</small>}
    </label>
  );
}
