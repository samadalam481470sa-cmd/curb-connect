'use client';

// Curb Cutting home: the org's curb projects and a "New curb project" entry (CV-041). Separate
// navigation from roof; nothing here is sample data (STR-005).
import { DataTable, EmptyState, StatusPill, type DataTableColumn } from '@fieldline/ui';
import type { CurbProject } from '@fieldline/contracts';
import { useQuery } from '@tanstack/react-query';
import { orgKey, useSession } from '../../lib/session';
import { ButtonLink, ErrorNotice, PageHeader } from '../common';
import { RouteGate } from '../RouteGate';
import { serviceTaxon } from './model';
import { useCurbEndpoints } from './useCurbProject';

export function CurbHome() {
  return (
    <RouteGate routeId="curb">
      <CurbList />
    </RouteGate>
  );
}

function CurbList() {
  const curb = useCurbEndpoints();
  const session = useSession();
  const q = useQuery({ queryKey: orgKey(session.orgId, 'curb', 'list'), queryFn: () => curb.list() });
  const canCreate = session.can('curb_project:write');
  const columns: DataTableColumn<CurbProject>[] = [
    { id: 'number', header: 'Project', cell: (p) => <a href={`/curb/projects/${p.id}`}>{p.number}</a> },
    { id: 'service', header: 'Service', cell: (p) => serviceTaxon(p.serviceCode)?.label ?? p.serviceCode },
    { id: 'status', header: 'Status', cell: (p) => <StatusPill status={p.status} /> },
    { id: 'row', header: 'Right-of-way', cell: (p) => (p.isPublicRightOfWay === null ? 'Unknown' : p.isPublicRightOfWay ? 'Public' : 'Private') },
  ];
  return (
    <>
      <PageHeader title="Curb Cutting" description="Guided capture, calibration, field dimensions and gated estimates." actions={canCreate ? <ButtonLink href="/curb/new">New curb project</ButtonLink> : undefined} />
      {q.error && <ErrorNotice error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && q.data.items.length === 0 && <EmptyState title="No curb projects yet" description="Start a project to capture the site and answer the permit questions." />}
      {q.data && q.data.items.length > 0 && <DataTable caption="Curb projects" columns={columns} rows={q.data.items} rowKey={(p) => p.id} />}
    </>
  );
}
