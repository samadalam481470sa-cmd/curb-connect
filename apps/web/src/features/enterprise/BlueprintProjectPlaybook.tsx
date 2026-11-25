'use client';

import {
  ENTERPRISE_PLAYBOOK_PHASES,
  ENTERPRISE_PROJECT_TYPES,
  workPackageLabel,
  type EnterprisePlaybookPhaseKey,
  type EnterpriseProjectTypeKey,
} from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { ProjectPlaybook, type PlaybookStepType } from './playbookSchemas';
import { ProjectList } from './schemas';

const STEP_STATUS_LABEL = {
  missing: 'Missing',
  in_progress: 'In progress',
  blocked: 'Blocked',
  at_risk: 'At risk',
  complete: 'Complete',
} as const;

const GATE_STATUS_LABEL = {
  not_started: 'Not started',
  in_progress: 'In progress',
  at_risk: 'At risk',
  blocked: 'Blocked',
  complete: 'Complete',
} as const;

export function BlueprintProjectPlaybook({
  onOpenRecord,
  onOpenPackage,
}: {
  onOpenRecord: (packageCode: string, recordId: string) => void;
  onOpenPackage: (packageCode: string) => void;
}) {
  const { api } = useApi();
  const session = useSession();
  const prefix = orgKey(session.orgId, 'enterprise');
  const [projectId, setProjectId] = useState('');
  const [projectType, setProjectType] = useState<EnterpriseProjectTypeKey>('residential');
  const [phase, setPhase] = useState<EnterprisePlaybookPhaseKey | 'all'>('all');

  const projects = useQuery({
    queryKey: [...prefix, 'projects'],
    queryFn: () => api.get('/v1/enterprise/projects', { schema: ProjectList }),
  });
  const selectedProjectId = projectId || projects.data?.items[0]?.id || '';
  const playbook = useQuery({
    queryKey: [...prefix, 'blueprint', 'playbook', selectedProjectId, projectType, phase],
    queryFn: () =>
      api.get('/v1/enterprise/projects/' + encodeURIComponent(selectedProjectId) + '/playbook', {
        schema: ProjectPlaybook,
        query: { type: projectType, phase: phase === 'all' ? undefined : phase },
      }),
    enabled: Boolean(selectedProjectId),
  });

  const data = playbook.data;
  return (
    <section className="blueprint-playbook" aria-label="Project playbook">
      <div className="enterprise-panel blueprint-playbook-hero">
        <span className="enterprise-kicker">PROJECT PLAYBOOK</span>
        <h2>Required work by project type and phase</h2>
        <p>
          Select a project, project type and phase. The playbook narrows the blueprint catalog to
          the records this project needs, then shows each phase gate, the package or record owner,
          and the next action.
        </p>
        <div className="blueprint-playbook-controls">
          <label>
            Project
            <select
              value={selectedProjectId}
              onChange={(event) => setProjectId(event.target.value)}
              disabled={projects.isPending}
            >
              {!selectedProjectId && <option value="">Choose a project…</option>}
              {projects.data?.items.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Project type
            <select
              value={projectType}
              onChange={(event) => setProjectType(event.target.value as EnterpriseProjectTypeKey)}
            >
              {ENTERPRISE_PROJECT_TYPES.map((type) => (
                <option key={type.key} value={type.key}>
                  {type.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Phase
            <select
              value={phase}
              onChange={(event) =>
                setPhase(event.target.value as EnterprisePlaybookPhaseKey | 'all')
              }
            >
              <option value="all">All phases</option>
              {ENTERPRISE_PLAYBOOK_PHASES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="enterprise-muted blueprint-playbook-context">
          {ENTERPRISE_PROJECT_TYPES.find((type) => type.key === projectType)?.description}
        </p>
        {projects.error && (
          <p className="enterprise-error" role="alert">
            Projects could not load: {errorHint(projects.error)}
          </p>
        )}
        {!projects.isPending && projects.data?.items.length === 0 && (
          <p className="enterprise-empty">
            No Enterprise project yet. Create one in the{' '}
            <a href="/enterprise">Enterprise workspace</a> first.
          </p>
        )}
      </div>

      {playbook.isPending && selectedProjectId && (
        <p className="enterprise-muted">Building the project playbook…</p>
      )}
      {playbook.error && (
        <p className="enterprise-error" role="alert">
          Playbook could not load: {errorHint(playbook.error)}
        </p>
      )}

      {data && (
        <>
          <div className="enterprise-kpis blueprint-playbook-kpis" aria-label="Playbook summary">
            <div>
              <span>Required records</span>
              <strong>{data.summary.required}</strong>
            </div>
            <div>
              <span>Complete</span>
              <strong>{data.summary.complete}</strong>
            </div>
            <div>
              <span>Missing</span>
              <strong>{data.summary.missing}</strong>
            </div>
            <div>
              <span>Blocked or at risk</span>
              <strong>{data.summary.blocked + data.summary.atRisk}</strong>
            </div>
          </div>

          {data.summary.nextAction && (
            <div className="enterprise-panel blueprint-playbook-next" role="status">
              <span className="enterprise-kicker">NEXT ACTION</span>
              <strong>{data.summary.nextAction.label}</strong>
              <p>
                {data.summary.nextAction.packageCode} · {data.summary.nextAction.title} ·{' '}
                {data.summary.nextAction.detail}
              </p>
              <button
                type="button"
                className="blueprint-link"
                onClick={() => onOpenPackage(data.summary.nextAction!.packageCode)}
              >
                Open work package
              </button>
            </div>
          )}

          <div className="blueprint-playbook-phases">
            {data.phases.map((item) => (
              <article key={item.key} className="enterprise-panel blueprint-playbook-phase">
                <div className="blueprint-playbook-phase-head">
                  <div>
                    <h3>{item.label}</h3>
                    <p>{item.description}</p>
                  </div>
                  <span
                    className={
                      'blueprint-playbook-gate blueprint-playbook-gate--' + item.gate.status
                    }
                  >
                    {item.gate.label} · {GATE_STATUS_LABEL[item.gate.status]}
                  </span>
                </div>
                <p className="enterprise-muted blueprint-playbook-gate-detail">
                  {item.gate.description} · {item.gate.complete}/{item.gate.required} required
                  records complete
                </p>
                <ol className="blueprint-playbook-steps">
                  {item.steps.map((step) => (
                    <PlaybookStep
                      key={step.packageCode}
                      step={step}
                      onOpenRecord={onOpenRecord}
                      onOpenPackage={onOpenPackage}
                    />
                  ))}
                </ol>
              </article>
            ))}
          </div>
          <p className="enterprise-muted blueprint-playbook-footnote">
            Generated {new Date(data.generatedAt).toLocaleString()} for {data.project.name}. Gates
            close when every required record in the phase is complete; the latest record per package
            drives the owner and next action.
          </p>
        </>
      )}
    </section>
  );
}

function PlaybookStep({
  step,
  onOpenRecord,
  onOpenPackage,
}: {
  step: PlaybookStepType;
  onOpenRecord: (packageCode: string, recordId: string) => void;
  onOpenPackage: (packageCode: string) => void;
}) {
  return (
    <li className={'blueprint-playbook-step blueprint-playbook-step--' + step.status}>
      <div className="blueprint-playbook-step-main">
        <span className="blueprint-code">{step.packageCode}</span>
        <strong>{step.title}</strong>
        <span
          className={
            'blueprint-playbook-step-status blueprint-playbook-step-status--' + step.status
          }
        >
          {STEP_STATUS_LABEL[step.status]}
        </span>
      </div>
      <div className="blueprint-playbook-step-meta">
        <span>
          Owner: {step.owner.name} ·{' '}
          {step.owner.source === 'record' ? 'record owner' : 'package owner'}
        </span>
        <span>
          {step.record ? `Stage: ${workPackageLabel(step.record.status)}` : 'No project record yet'}
        </span>
        <span>Blueprint gate {step.releaseGate}</span>
        {step.recordCount > 1 && <span>{step.recordCount} records · latest shown</span>}
        {step.record?.dueOn && <span>Due {step.record.dueOn}</span>}
      </div>
      <div className="blueprint-playbook-step-action">
        <p>
          <strong>{step.nextAction.label}</strong>
          <span>{step.nextAction.detail}</span>
        </p>
        {step.record ? (
          <button
            type="button"
            className="blueprint-link"
            onClick={() => onOpenRecord(step.packageCode, step.record!.id)}
          >
            Open record
          </button>
        ) : (
          <button
            type="button"
            className="blueprint-link"
            onClick={() => onOpenPackage(step.packageCode)}
          >
            Open work package
          </button>
        )}
      </div>
    </li>
  );
}
