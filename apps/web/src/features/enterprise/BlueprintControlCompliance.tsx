'use client';

import { controlComplianceLabel, type ControlComplianceStatus } from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { ControlAuditPacket, ControlCompliance } from './controlSchemas';
import { BlueprintControlRequirement } from './BlueprintControlRequirement';

export function BlueprintControlCompliance({
  moduleKey,
  pageStart,
  members,
  statusFilter = null,
  onClearFilter,
}: {
  moduleKey: string;
  pageStart: number | null;
  members: { userId: string; displayName: string }[];
  statusFilter?: ControlComplianceStatus | null;
  onClearFilter?: () => void;
}) {
  const { api } = useApi();
  const session = useSession();
  const prefix = orgKey(session.orgId, 'enterprise');
  const [exporting, setExporting] = useState<'module' | 'suite' | ''>('');
  const [exportError, setExportError] = useState('');
  const [exportedDigest, setExportedDigest] = useState('');
  const compliance = useQuery({
    queryKey: [...prefix, 'blueprint', 'controls', moduleKey],
    queryFn: () =>
      api.get('/v1/enterprise/blueprint/controls', {
        schema: ControlCompliance,
        query: { module: moduleKey },
      }),
  });

  const data = compliance.data;
  const module = data?.modules[0];
  const requirements = module
    ? statusFilter
      ? module.requirements.filter((requirement) => requirement.status === statusFilter)
      : module.requirements
    : [];

  const exportPacket = async (scope: 'module' | 'suite') => {
    setExporting(scope);
    setExportError('');
    try {
      const packet = await api.get('/v1/enterprise/blueprint/controls/audit-packet', {
        schema: ControlAuditPacket,
        query: scope === 'module' ? { module: moduleKey } : undefined,
      });
      const blob = new Blob([JSON.stringify(packet, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `fieldline-control-audit-${data?.today ?? 'export'}${
        scope === 'module' ? `-${moduleKey}` : '-all-modules'
      }.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setExportedDigest(packet.integrity.digest);
    } catch (cause) {
      setExportError(cause instanceof Error ? cause.message : errorHint(cause));
    } finally {
      setExporting('');
    }
  };

  return (
    <div className="blueprint-compliance">
      <div className="blueprint-compliance-head">
        <div>
          <span className="enterprise-kicker">EVIDENCE-BACKED REQUIREMENTS</span>
          <h3>18 control gates</h3>
          <p>
            Assign an owner and refresh date to every gate, attach evidence and have an independent
            reviewer accept it. A gate is satisfied only by accepted evidence that has not expired.
          </p>
        </div>
        <div className="blueprint-compliance-actions">
          <button
            type="button"
            className="enterprise-quiet"
            onClick={() => void exportPacket('module')}
            disabled={Boolean(exporting)}
          >
            {exporting === 'module' ? 'Building packet…' : 'Export module packet'}
          </button>
          <button
            type="button"
            className="enterprise-quiet"
            onClick={() => void exportPacket('suite')}
            disabled={Boolean(exporting)}
          >
            {exporting === 'suite' ? 'Building packet…' : 'Export all 13 modules'}
          </button>
        </div>
      </div>

      {compliance.isPending && <p className="enterprise-muted">Loading control requirements…</p>}
      {compliance.error && (
        <p className="enterprise-error" role="alert">
          Control requirements could not load: {errorHint(compliance.error)}
        </p>
      )}
      {exportError && (
        <p className="enterprise-error" role="alert">
          Audit packet could not be exported: {exportError}
        </p>
      )}
      {exportedDigest && (
        <p className="enterprise-success" role="status">
          Audit packet exported · SHA-256 <code>{exportedDigest}</code>
        </p>
      )}

      {module && data && (
        <>
          <div
            className="enterprise-kpis blueprint-compliance-kpis"
            aria-label="Gate compliance summary"
          >
            <div>
              <span>Gates</span>
              <strong>{module.counts.total}</strong>
            </div>
            <div>
              <span>Satisfied</span>
              <strong>{module.counts.satisfied}</strong>
            </div>
            <div>
              <span>Pending review</span>
              <strong>{module.counts.pending_review}</strong>
            </div>
            <div>
              <span>Expiring</span>
              <strong>{module.counts.expiring}</strong>
            </div>
            <div>
              <span>Expired or missing</span>
              <strong>{module.counts.expired + module.counts.missing}</strong>
            </div>
            <div>
              <span>Attachments</span>
              <strong>{module.counts.attachments}</strong>
            </div>
          </div>

          {statusFilter && (
            <p className="blueprint-compliance-filter" role="status">
              Showing <strong>{requirements.length}</strong> of {module.requirements.length} gates ·{' '}
              {controlComplianceLabel(statusFilter)}
              <button type="button" className="enterprise-quiet" onClick={onClearFilter}>
                Show all gates
              </button>
            </p>
          )}
          <div className="blueprint-requirements">
            {requirements.map((requirement) => (
              <BlueprintControlRequirement
                key={`${requirement.moduleKey}:${requirement.gateKey}`}
                requirement={requirement}
                members={members}
                page={pageStart === null ? null : pageStart + requirement.order - 1}
                onChanged={async () => {
                  await compliance.refetch();
                }}
              />
            ))}
            {requirements.length === 0 && (
              <p className="enterprise-empty">
                No control gates in this module currently have that status.
              </p>
            )}
          </div>
          <p className="enterprise-muted">
            Exported packets include requirement owners, expiry dates, evidence metadata, review
            decisions and a SHA-256 digest over the packet contents. Attachment bytes stay in
            encrypted storage and are downloaded separately with their recorded checksum.
          </p>
        </>
      )}
    </div>
  );
}
