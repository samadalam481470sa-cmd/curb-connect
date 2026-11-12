'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { useApi, useSession, orgKey } from '../../lib/session';
import { errorHint } from '../../lib/api';
import {
  ChangeOrder, ProjectList, ProjectRecords, Rfi, Submittal, SuiteStatus,
  type RfiRecord, type ChangeOrderRecord, type SubmittalRecord,
} from './schemas';

const PANELS = [
  { id: 'overview', label: 'Overview', description: 'Company opt-in and six enterprise workspaces' },
  { id: 'bim', label: 'BIM & 3D', description: 'Structural, MEP and building models' },
  { id: 'takeoff', label: 'Digital Takeoff', description: 'Measured 2D plans, assemblies and pricing' },
  { id: 'controls', label: 'Project Controls', description: 'RFIs, submittals and change orders' },
  { id: 'field', label: 'Field Execution', description: 'Punch items, floor-plan pins and daily logs' },
  { id: 'vault', label: 'Document Vault', description: 'Immutable version history and compliance' },
  { id: 'costing', label: 'Job Costing', description: 'Schedule of values, retainage and forecasts' },
] as const;
export type EnterpriseArea = typeof PANELS[number]['id'];

function cents(value: string): number {
  const text = value.trim().replaceAll(',', '');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) throw new Error('Enter a dollar amount with at most two decimals.');
  const neg = text.startsWith('-');
  const [whole, fraction = ''] = (neg ? text.slice(1) : text).split('.');
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(minor) || minor > 1_000_000_000_000) throw new Error('Amount exceeds the allowed limit.');
  return neg ? -minor : minor;
}
const money = (value: number) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD',
}).format(value / 100);
const statusText = (value: string) => value.replaceAll('_', ' ');
const RFI_FLOW: Record<string, string[]> = {
  draft: ['open'], open: ['answered', 'closed'], answered: ['closed'], closed: [],
};
const CO_FLOW: Record<string, string[]> = {
  pco_draft: ['pricing_requested', 'rejected'], pricing_requested: ['priced', 'rejected'],
  priced: ['submitted_to_owner', 'rejected'], submitted_to_owner: ['approved', 'rejected'],
  approved: [], rejected: [],
};
const SUB_FLOW: Record<string, string[]> = {
  required: ['submitted'], submitted: ['under_review'],
  under_review: ['approved', 'approved_as_noted', 'revise_and_resubmit', 'rejected'],
  revise_and_resubmit: ['submitted'], approved: [], approved_as_noted: [], rejected: [],
};

export function EnterpriseSuiteView({ area = 'overview' }: { area?: EnterpriseArea }) {
  const { api } = useApi();
  const session = useSession();
  const prefix = orgKey(session.orgId, 'enterprise');
  const status = useQuery({
    queryKey: [...prefix, 'status'],
    queryFn: () => api.get('/v1/enterprise/status', { schema: SuiteStatus }),
  });
  const projects = useQuery({
    queryKey: [...prefix, 'projects'],
    queryFn: () => api.get('/v1/enterprise/projects', { schema: ProjectList }),
    enabled: status.data?.enabled === true,
  });
  const [requestedProject, setRequestedProject] = useState('');
  const projectId = projects.data?.items.some((p) => p.id === requestedProject)
    ? requestedProject : (projects.data?.items[0]?.id ?? '');
  const records = useQuery({
    queryKey: [...prefix, 'records', projectId],
    queryFn: () => api.get('/v1/enterprise/projects/' + encodeURIComponent(projectId) + '/records',
      { schema: ProjectRecords }),
    enabled: status.data?.enabled === true && !!projectId,
  });
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [projectName, setProjectName] = useState('');
  const [contractValue, setContractValue] = useState('0');
  const [rfiSubject, setRfiSubject] = useState('');
  const [rfiQuestion, setRfiQuestion] = useState('');
  const [rfiAssignee, setRfiAssignee] = useState('');
  const [rfiResponse, setRfiResponse] = useState('');
  const [coNumber, setCoNumber] = useState('');
  const [coTitle, setCoTitle] = useState('');
  const [coAmount, setCoAmount] = useState('0');
  const [subNumber, setSubNumber] = useState('');
  const [subTitle, setSubTitle] = useState('');
  const [subReviewer, setSubReviewer] = useState('');
  const [subDocument, setSubDocument] = useState('');
  const [sovNumber, setSovNumber] = useState('1');
  const [sovCode, setSovCode] = useState('03 30 00');
  const [sovDescription, setSovDescription] = useState('');
  const [sovScheduled, setSovScheduled] = useState('0');
  const [sovPrevious, setSovPrevious] = useState('0');
  const [sovCurrent, setSovCurrent] = useState('0');
  const [sovStored, setSovStored] = useState('0');
  const [sovRetainage, setSovRetainage] = useState('10');

  const section = useMemo(() => PANELS.find((p) => p.id === area) ?? PANELS[0]!, [area]);
  const refresh = async () => {
    await Promise.all([status.refetch(), projects.refetch(), ...(projectId ? [records.refetch()] : [])]);
  };

  const perform = async (name: string, task: () => Promise<unknown>, after?: () => void) => {
    setBusy(name); setError(''); setNotice('');
    try {
      await task();
      after?.();
      await refresh();
      setNotice(name + ' saved.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : errorHint(cause));
    } finally {
      setBusy('');
    }
  };

  const enableSuite = (enabled: boolean) => void perform(enabled ? 'Suite enabled' : 'Suite disabled',
    () => api.put('/v1/enterprise/status', { enabled }));

  const createProject = (event: FormEvent) => {
    event.preventDefault();
    void perform('Project', () => api.post('/v1/enterprise/projects', {
      name: projectName.trim(), originalContractMinor: cents(contractValue),
    }), () => setProjectName(''));
  };

  const createRfi = (event: FormEvent) => {
    event.preventDefault();
    void perform('RFI draft', () => api.post('/v1/enterprise/projects/' + projectId + '/rfis', {
      subject: rfiSubject.trim(), question: rfiQuestion.trim(), ballInCourt: rfiAssignee.trim(),
    }), () => { setRfiSubject(''); setRfiQuestion(''); });
  };

  const createCo = (event: FormEvent) => {
    event.preventDefault();
    void perform('Potential change order', () => api.post('/v1/enterprise/projects/' + projectId + '/change-orders', {
      number: coNumber.trim(), title: coTitle.trim(), description: coTitle.trim(),
      amountDeltaMinor: cents(coAmount),
    }), () => { setCoNumber(''); setCoTitle(''); });
  };

  const createSub = (event: FormEvent) => {
    event.preventDefault();
    void perform('Submittal', () => api.post('/v1/enterprise/projects/' + projectId + '/submittals', {
      number: subNumber.trim(), title: subTitle.trim(), reviewer: subReviewer.trim(),
      documentReference: subDocument.trim() || undefined,
    }), () => { setSubNumber(''); setSubTitle(''); });
  };

  const createSov = (event: FormEvent) => {
    event.preventDefault();
    void perform('SOV line', () => api.post('/v1/enterprise/projects/' + projectId + '/sov', {
      lineNumber: Number(sovNumber), costCode: sovCode.trim(), description: sovDescription.trim(),
      scheduledMinor: cents(sovScheduled), previousMinor: cents(sovPrevious),
      currentMinor: cents(sovCurrent), storedMinor: cents(sovStored),
      retainageBps: Math.round(Number(sovRetainage) * 100),
    }), () => { setSovDescription(''); setSovNumber(String(Number(sovNumber) + 1)); });
  };

  const updateStatus = (kind: 'rfis' | 'change-orders' | 'submittals',
    item: RfiRecord | ChangeOrderRecord | SubmittalRecord, next: string) => {
    if (next === 'answered' && !rfiResponse.trim()) {
      setError('An official response is required before answering an RFI.');
      return;
    }
    const response = next === 'answered' || (kind === 'rfis' && next === 'closed' && item.status === 'open')
      ? { status: next, officialResponse: rfiResponse.trim() }
      : { status: next };
    void perform('Workflow status', () => api.patch('/v1/enterprise/' + kind + '/' + item.id + '/status',
      response, { ifMatch: item.revision }), () => { if (kind === 'rfis') setRfiResponse(''); });
  };

  return (
    <main className="enterprise-suite">
      <div className="enterprise-hero">
        <div className="enterprise-kicker">FIELD PRO // ISOLATED ENTERPRISE ADD-ON</div>
        <h1>{section.label === 'Overview' ? 'Commercial Construction Suite' : section.label}</h1>
        <p>{section.description}. Existing roofing, curb cutting, billing and plumbing routes remain unchanged.</p>
        <a href="/roof" className="enterprise-back">← Return to Roofing Mode</a>
      </div>

      <nav className="enterprise-nav" aria-label="Enterprise Suite modules">
        {PANELS.map((p) => <a key={p.id} href={p.id === 'overview' ? '/enterprise' : '/enterprise/' + p.id}
          aria-current={p.id === area ? 'page' : undefined}
          className={p.id === area ? 'enterprise-nav__active' : ''}>{p.label}</a>)}
      </nav>

      {status.isPending && <div className="enterprise-panel">Loading company Enterprise Suite status…</div>}
      {status.error && <div className="enterprise-error" role="alert">Cannot load suite: {errorHint(status.error)}</div>}
      {status.data && !status.data.enabled && (
        <section className="enterprise-panel" aria-label="Enterprise Suite activation">
          <h2>Commercial Suite is disabled for this company</h2>
          <p>Opt-in is required. No existing roofing settings or data are changed by enabling it.</p>
          {status.data.canManage
            ? <button type="button" disabled={!!busy} onClick={() => enableSuite(true)}>Enable isolated Enterprise Suite</button>
            : <p>Ask your organization owner or administrator to enable this add-on.</p>}
        </section>
      )}

      {status.data?.enabled && (
        <>
          <div className="enterprise-banner">
            <strong>Enterprise workspace enabled</strong>
            <span>Tenant-isolated data · existing Roofing Mode preserved</span>
            {status.data.canManage && <button type="button" disabled={!!busy} onClick={() => enableSuite(false)}>Disable access</button>}
          </div>
          <div className="enterprise-projectbar">
            <label>Commercial project
              <select value={projectId} onChange={(event) => { setRequestedProject(event.target.value); setError(''); }}>
                {projects.data?.items.length ? projects.data.items.map((p) =>
                  <option key={p.id} value={p.id}>{p.name}</option>)
                  : <option value="">Create a project</option>}
              </select>
            </label>
            <form onSubmit={createProject}>
              <input aria-label="New commercial project name" placeholder="New project name" required minLength={2}
                maxLength={255} value={projectName} onChange={(event) => setProjectName(event.target.value)} />
              <input aria-label="Original contract amount in dollars" type="text" inputMode="decimal"
                value={contractValue} onChange={(event) => setContractValue(event.target.value)} />
              <button disabled={!session.can('job:write') || !!busy} type="submit">Add project</button>
            </form>
          </div>
          {projects.error && <p className="enterprise-error">Projects could not load: {errorHint(projects.error)}</p>}
          {records.error && <p className="enterprise-error">Records could not load: {errorHint(records.error)}</p>}
          {notice && <p role="status" className="enterprise-success">{notice}</p>}
          {error && <p role="alert" className="enterprise-error">{error}</p>}

          {area === 'overview' && (
            <section className="enterprise-grid" aria-label="Enterprise modules">
              {PANELS.filter((p) => p.id !== 'overview').map((panel) => (
                <a key={panel.id} className="enterprise-card" href={'/enterprise/' + panel.id}>
                  <span>{panel.id === 'controls' || panel.id === 'costing' ? 'CORE WORKFLOW' : 'STAGED MODULE'}</span>
                  <h2>{panel.label}</h2>
                  <p>{panel.description}</p>
                  <strong>Open section ↗</strong>
                </a>
              ))}
            </section>
          )}

          {area === 'controls' && !projectId && <div className="enterprise-panel">Create a commercial project to start project controls.</div>}
          {area === 'controls' && projectId && (
            <div className="enterprise-stack">
              <section className="enterprise-panel">
                <h2>Requests for Information (RFIs)</h2>
                <form className="enterprise-form" onSubmit={createRfi}>
                  <input aria-label="RFI subject" required placeholder="RFI subject" value={rfiSubject}
                    onChange={(e) => setRfiSubject(e.target.value)} />
                  <input aria-label="Ball in court" required placeholder="Assigned reviewer / ball in court"
                    value={rfiAssignee} onChange={(e) => setRfiAssignee(e.target.value)} />
                  <textarea aria-label="RFI question" required placeholder="Design clarification required" value={rfiQuestion}
                    onChange={(e) => setRfiQuestion(e.target.value)} />
                  <button disabled={!session.can('job:write') || !!busy}>Create RFI draft</button>
                </form>
                <label className="enterprise-response">Official reviewer response
                  <textarea value={rfiResponse} onChange={(e) => setRfiResponse(e.target.value)}
                    placeholder="Used when answering or directly closing an open RFI" />
                </label>
                <div className="enterprise-records">
                  {records.data?.rfis.map((row) => (
                    <article key={row.id}>
                      <div><strong>RFI #{row.rfiNumber} · {row.subject}</strong>
                        <span>{row.ballInCourt} · {statusText(row.status)}</span>
                        <p>{row.question}</p>
                        {row.officialResponse && <p>Official response: {row.officialResponse}</p>}
                      </div>
                      <div className="enterprise-actions">
                        {(RFI_FLOW[row.status] ?? []).map((next) => (
                          <button key={next} type="button" disabled={!!busy || !session.can('job:write') ||
                              (next !== 'open' && !session.can('review_task:decide'))}
                            onClick={() => updateStatus('rfis', row, next)}>{statusText(next)}</button>
                        ))}
                      </div>
                    </article>
                  ))}
                  {!records.data?.rfis.length && <p>No RFIs created for this project.</p>}
                </div>
              </section>
              <section className="enterprise-panel">
                <h2>Potential & approved change orders</h2>
                <form className="enterprise-form" onSubmit={createCo}>
                  <input aria-label="PCO number" required placeholder="PCO-001" value={coNumber}
                    onChange={(e) => setCoNumber(e.target.value)} />
                  <input aria-label="Change order title" required placeholder="Change description" value={coTitle}
                    onChange={(e) => setCoTitle(e.target.value)} />
                  <label>Cost delta (USD)<input type="text" inputMode="decimal" value={coAmount}
                    onChange={(e) => setCoAmount(e.target.value)} /></label>
                  <button disabled={!session.can('job:write') || !!busy}>Create PCO</button>
                </form>
                <div className="enterprise-records">
                  {records.data?.changeOrders.map((row) => (
                    <article key={row.id}>
                      <div><strong>{row.number} · {row.title}</strong><span>{statusText(row.status)}</span>
                        <p>Cost impact {money(row.amountDeltaMinor)} · {row.scheduleImpactDays} days</p></div>
                      <div className="enterprise-actions">
                        {(CO_FLOW[row.status] ?? []).map((next) => (
                          <button key={next} type="button" disabled={!!busy ||
                            !session.can('job:write') || (next === 'approved' && !session.can('org:settings_update'))}
                            onClick={() => updateStatus('change-orders', row, next)}>{statusText(next)}</button>
                        ))}
                      </div>
                    </article>
                  ))}
                  {!records.data?.changeOrders.length && <p>No potential change orders created.</p>}
                </div>
              </section>
              <section className="enterprise-panel">
                <h2>Submittals & shop drawing references</h2>
                <p className="enterprise-muted">External document references are manually provided, not verified vault uploads.</p>
                <form className="enterprise-form" onSubmit={createSub}>
                  <input aria-label="Submittal number" required placeholder="SUB-001" value={subNumber} onChange={(e) => setSubNumber(e.target.value)} />
                  <input aria-label="Submittal title" required placeholder="Shop drawing title" value={subTitle} onChange={(e) => setSubTitle(e.target.value)} />
                  <input aria-label="Reviewer" required placeholder="Reviewer name" value={subReviewer} onChange={(e) => setSubReviewer(e.target.value)} />
                  <input aria-label="External document reference" placeholder="Document reference (optional)" value={subDocument} onChange={(e) => setSubDocument(e.target.value)} />
                  <button disabled={!session.can('job:write') || !!busy}>Add required submittal</button>
                </form>
                <div className="enterprise-records">
                  {records.data?.submittals.map((row) => <article key={row.id}>
                    <div><strong>{row.number} · {row.title}</strong><span>Revision {row.currentRevision} · {statusText(row.status)}</span>
                      <p>Reviewer: {row.reviewer} · reference {row.documentReference || 'not supplied'}</p></div>
                    <div className="enterprise-actions">
                      {(SUB_FLOW[row.status] ?? []).map((next) => <button key={next} type="button"
                        disabled={!!busy || !session.can('job:write') ||
                          (['approved','approved_as_noted','revise_and_resubmit','rejected'].includes(next) && !session.can('review_task:decide'))}
                        onClick={() => updateStatus('submittals', row, next)}>{statusText(next)}</button>)}
                    </div>
                  </article>)}
                  {!records.data?.submittals.length && <p>No submittals recorded.</p>}
                </div>
              </section>
            </div>
          )}

          {area === 'costing' && (
            <div className="enterprise-stack">
              <section className="enterprise-panel">
                <h2>Schedule of Values · preliminary progress billing</h2>
                <p>Contract values are stored separately from your existing invoice ledger. Only approved enterprise change orders affect the revised contract.</p>
                {projectId ? <>
                  <div className="enterprise-kpis">
                    <div><span>Original contract</span><strong>{money(records.data?.summary.originalContractMinor ?? 0)}</strong></div>
                    <div><span>Approved changes</span><strong>{money(records.data?.summary.approvedChangeMinor ?? 0)}</strong></div>
                    <div><span>Revised contract</span><strong>{money(records.data?.summary.revisedContractMinor ?? 0)}</strong></div>
                    <div><span>Completed & stored</span><strong>{money(records.data?.summary.completedMinor ?? 0)}</strong></div>
                    <div><span>Retainage</span><strong>{money(records.data?.summary.retainageMinor ?? 0)}</strong></div>
                    <div><span>Earned less retainage</span><strong>{money(records.data?.summary.earnedLessRetainageMinor ?? 0)}</strong></div>
                  </div>
                  <form className="enterprise-form" onSubmit={createSov}>
                    <input aria-label="SOV line number" type="number" min="1" required value={sovNumber} onChange={(e) => setSovNumber(e.target.value)} />
                    <input aria-label="CSI cost code" required value={sovCode} onChange={(e) => setSovCode(e.target.value)} />
                    <input aria-label="SOV description" required placeholder="Scope line description" value={sovDescription} onChange={(e) => setSovDescription(e.target.value)} />
                    <label>Scheduled $<input inputMode="decimal" value={sovScheduled} onChange={(e) => setSovScheduled(e.target.value)} /></label>
                    <label>Previously complete $<input inputMode="decimal" value={sovPrevious} onChange={(e) => setSovPrevious(e.target.value)} /></label>
                    <label>This period $<input inputMode="decimal" value={sovCurrent} onChange={(e) => setSovCurrent(e.target.value)} /></label>
                    <label>Stored materials $<input inputMode="decimal" value={sovStored} onChange={(e) => setSovStored(e.target.value)} /></label>
                    <label>Retainage %<input inputMode="decimal" value={sovRetainage} onChange={(e) => setSovRetainage(e.target.value)} /></label>
                    <button disabled={!session.can('estimate:write') || !!busy}>Add SOV line</button>
                  </form>
                  <div className="enterprise-scroll"><table><thead><tr>
                    <th>Item</th><th>Cost code</th><th>Scope</th><th>Scheduled</th><th>Previous</th><th>Current</th><th>Stored</th>
                    </tr></thead><tbody>
                    {records.data?.sovLines.map((line) => <tr key={line.id}>
                      <td>{line.lineNumber}</td><td>{line.costCode}</td><td>{line.description}</td>
                      <td>{money(line.scheduledMinor)}</td><td>{money(line.previousMinor)}</td>
                      <td>{money(line.currentMinor)}</td><td>{money(line.storedMinor)}</td>
                    </tr>)}
                    </tbody></table></div>
                  <p className="enterprise-muted">Preliminary progress summary only: not a licensed AIA G702/G703 form, certified pay application, or synced accounting entry.</p>
                </> : <p>Create a project to add Schedule of Values lines.</p>}
              </section>
            </div>
          )}
          {area === 'bim' && <InfoPanel title="BIM & Parametric Studio"
            details="The separate enterprise project foundation is installed. IFC/CAD conversion, watertight multistorey glTF, LOD streaming and accurate 2D alignment require a verified geometry pipeline and are not exposed as working yet." />}
          {area === 'takeoff' && <InfoPanel title="Digital Takeoff & Markup"
            details="A calibrated PDF.js vector reader, assembly dependency graph and regional supplier pricing are planned for this isolated section. Existing roofing measurements and estimates are unchanged." />}
          {area === 'field' && <InfoPanel title="Field Execution"
            details="Mobile punch pins, photographed QA evidence, durable offline queues and conflict resolution are not yet enabled. Field records must not be described as synchronized until server reconciliation exists." />}
          {area === 'vault' && <InfoPanel title="Document Vault & Compliance"
            details="Separate tenant-scoped document metadata and append-only event tables are prepared. File uploads, signed R2/S3 URLs, immutable object storage, COI expiration checks and external portals are not enabled yet." />}
        </>
      )}
    </main>
  );
}

function InfoPanel({ title, details }: { title: string; details: string }) {
  return <section className="enterprise-panel enterprise-info">
    <div className="enterprise-kicker">STAGED MODULE · NOT YET RELEASED</div>
    <h2>{title}</h2><p>{details}</p>
    <p>All existing roofing, construction, billing and plumbing capabilities remain available in their original locations.</p>
  </section>;
}
