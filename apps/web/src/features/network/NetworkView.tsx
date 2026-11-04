'use client';

// Workstream 06 and 10: find companies that opted into the directory, connect with them, and share
// projects. A connection grants only the scopes shown here; there is no blanket access and the
// directory is never presented as a complete list of contractors.
import { type CompanyCard, type Connection } from '@fieldline/contracts';
import {
  Button,
  DataTable,
  Field,
  Select,
  StatusPill,
  TextInput,
  useToast,
  type DataTableColumn,
} from '@fieldline/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ErrorNotice, GuardedButton, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint, newIdempotencyKey } from '../../lib/api';
import { useDisplay } from '../../lib/display';
import { formatMoney } from '../../lib/format';
import { orgKey, useApi, useSession } from '../../lib/session';

export function parseMoneyInput(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function NetworkView() {
  return (
    <RouteGate routeId="network">
      <NetworkContent />
    </RouteGate>
  );
}

function NetworkContent() {
  const { endpoints } = useApi();
  const session = useSession();
  const queryClient = useQueryClient();
  const display = useDisplay();
  const toast = useToast();
  const connectionsKey = orgKey(session.orgId, 'network', 'connections');
  const projectsKey = orgKey(session.orgId, 'network', 'projects');

  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState<string | undefined>(undefined);
  const directoryKey = orgKey(session.orgId, 'network', 'directory', submittedQuery ?? '');
  const directory = useQuery({
    queryKey: directoryKey,
    queryFn: () => endpoints.directory(submittedQuery),
  });
  const connections = useQuery({ queryKey: connectionsKey, queryFn: () => endpoints.connections() });
  const projects = useQuery({ queryKey: projectsKey, queryFn: () => endpoints.networkProjects() });

  const connectCheck = session.check('network:connect');
  const manageCheck = session.check('network:listing_update');
  const [connectKey, setConnectKey] = useState(newIdempotencyKey);
  const request = useMutation({
    mutationFn: (card: CompanyCard) =>
      endpoints.requestConnection(
        { partnerOrgId: card.orgId, scopes: ['invoices', 'projects'] },
        connectKey,
      ),
    onSuccess: (connection) => {
      toast.show({ tone: 'success', message: `Request sent to ${connection.partnerDisplayName}.` });
      setConnectKey(newIdempotencyKey());
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
      void queryClient.invalidateQueries({ queryKey: directoryKey });
    },
    onError: (error) => toast.show({ tone: 'danger', message: errorHint(error) }),
  });

  const incoming = (connections.data?.items ?? []).filter(
    (c) => c.status === 'pending' && c.direction === 'incoming',
  );
  const others = (connections.data?.items ?? []).filter(
    (c) => !(c.status === 'pending' && c.direction === 'incoming'),
  );

  const columns: DataTableColumn<CompanyCard>[] = [
    { id: 'name', header: 'Company', primary: true, sortValue: (c) => c.displayName, cell: (c) => c.displayName },
    {
      id: 'trades',
      header: 'Trades',
      cell: (c) => c.productLines.map((p) => (p === 'roof' ? 'Roofing' : 'Curb cutting')).join(', ') || '—',
    },
    { id: 'area', header: 'Service area', cell: (c) => c.serviceArea ?? 'Not stated' },
    {
      id: 'status',
      header: 'Relationship',
      cell: (c) => (c.connectionStatus ? <StatusPill status={c.connectionStatus} size="sm" /> : 'Not connected'),
    },
    {
      id: 'actions',
      header: 'Action',
      cell: (c) =>
        c.connectionStatus ? (
          <span className="web-muted web-small">Request {c.connectionStatus}</span>
        ) : (
          <GuardedButton
            size="sm"
            deniedReason={connectCheck.allowed ? undefined : connectCheck.reason}
            loading={request.isPending && request.variables?.orgId === c.orgId}
            onClick={() => request.mutate(c)}
          >
            Request connection
          </GuardedButton>
        ),
    },
  ];

  const search = (event: FormEvent) => {
    event.preventDefault();
    setSubmittedQuery(query.trim() || undefined);
  };

  return (
    <>
      <PageHeader
        title="Network"
        description="Connect with other construction companies to exchange invoices and share projects. Only companies that opted in appear here; this is not a complete directory."
      />

      <section aria-labelledby="directory-heading" className="web-section">
        <h2 id="directory-heading">Company directory</h2>
        <form className="web-inline-form" onSubmit={search} role="search">
          <Field label="Search companies" labelHidden>
            <TextInput
              value={query}
              placeholder="Search by company name"
              onChange={(e) => setQuery(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary">
            Search
          </Button>
        </form>
        {directory.error ? (
          <ErrorNotice error={directory.error} title="The directory could not be loaded" onRetry={() => void directory.refetch()} />
        ) : (
          <DataTable
            caption="Companies in the directory"
            captionHidden
            columns={columns}
            rows={directory.data?.items ?? []}
            rowKey={(c) => c.orgId}
            state={directory.isPending ? { status: 'loading', label: 'Loading companies' } : undefined}
            emptyTitle="No companies match. Only companies that opted in are listed."
          />
        )}
      </section>

      <section aria-labelledby="requests-heading" className="web-section">
        <h2 id="requests-heading">Requests to review</h2>
        {incoming.length === 0 ? (
          <p className="web-muted">No pending requests.</p>
        ) : (
          <ul className="web-list" aria-label="Pending connection requests">
            {incoming.map((connection) => (
              <li key={connection.id}>
                <span>
                  <strong>{connection.partnerDisplayName}</strong> · scopes: {connection.scopes.join(', ')}
                  {connection.message ? ` · “${connection.message}”` : ''}
                </span>{' '}
                <ConnectionDecision connection={connection} onDone={() => { void queryClient.invalidateQueries({ queryKey: connectionsKey }); }} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="connections-heading" className="web-section">
        <h2 id="connections-heading">Your connections</h2>
        {connections.error ? (
          <ErrorNotice error={connections.error} title="Connections could not be loaded" onRetry={() => void connections.refetch()} />
        ) : others.length === 0 ? (
          <p className="web-muted">No connections yet. Send a request from the directory above.</p>
        ) : (
          <ul className="web-list" aria-label="Connections">
            {others.map((connection) => (
              <li key={connection.id}>
                <span>
                  <strong>{connection.partnerDisplayName}</strong> · {connection.direction} ·{' '}
                  <StatusPill status={connection.status} size="sm" /> · {connection.scopes.join(', ')}
                </span>{' '}
                {(connection.status === 'active' || connection.status === 'pending') && (
                  <RevokeConnection id={connection.id} onDone={() => { void queryClient.invalidateQueries({ queryKey: connectionsKey }); }} />
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="projects-heading" className="web-section">
        <h2 id="projects-heading">Shared projects</h2>
        <ShareProjectForm
          connections={(connections.data?.items ?? []).filter(
            (c) => c.status === 'active' && c.scopes.includes('projects'),
          )}
          onShared={() => { void queryClient.invalidateQueries({ queryKey: projectsKey }); }}
          deniedReason={connectCheck.allowed ? undefined : connectCheck.reason}
        />
        {projects.error ? (
          <ErrorNotice error={projects.error} title="Shared projects could not be loaded" onRetry={() => void projects.refetch()} />
        ) : (projects.data?.items ?? []).length === 0 ? (
          <p className="web-muted">No shared projects yet.</p>
        ) : (
          <ul className="web-list" aria-label="Shared projects">
            {(projects.data?.items ?? []).map((project) => (
              <li key={project.id}>
                <span>
                  <strong>{project.name}</strong> · {project.reference} · with {project.partnerDisplayName} ·{' '}
                  {project.side === 'lead' ? 'you lead' : 'partner leads'}
                  {project.contractValue
                    ? ` · ${formatMoney(project.contractValue, display.locale)}`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="visibility-heading" className="web-section">
        <h2 id="visibility-heading">Directory visibility</h2>
        <p className="web-muted">
          Your company is not listed unless you opt in. Changing your listing keeps every existing
          connection and record.
        </p>
        <GuardedButton
          variant="secondary"
          deniedReason={manageCheck.allowed ? undefined : manageCheck.reason}
          onClick={async () => {
            try {
              const result = await endpoints.updateNetworkListing({ directoryOptIn: true });
              toast.show({
                tone: 'success',
                message: result.directoryOptIn
                  ? 'Your company is now listed in the directory.'
                  : 'Your company was removed from the directory.',
              });
            } catch (error) {
              toast.show({ tone: 'danger', message: errorHint(error) });
            }
          }}
        >
          List my company in the directory
        </GuardedButton>
      </section>
    </>
  );
}

function ConnectionDecision({ connection, onDone }: { connection: Connection; onDone: () => void }) {
  const { endpoints } = useApi();
  const toast = useToast();
  const accept = useMutation({
    mutationFn: () => endpoints.acceptConnection(connection.id),
    onSuccess: () => {
      toast.show({ tone: 'success', message: `Connected with ${connection.partnerDisplayName}.` });
      onDone();
    },
    onError: (error) => toast.show({ tone: 'danger', message: errorHint(error) }),
  });
  const decline = useMutation({
    mutationFn: () => endpoints.declineConnection(connection.id),
    onSuccess: () => {
      toast.show({ tone: 'success', message: 'Request declined.' });
      onDone();
    },
    onError: (error) => toast.show({ tone: 'danger', message: errorHint(error) }),
  });
  return (
    <span className="web-inline-form">
      <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate()}>
        Accept
      </Button>
      <Button size="sm" variant="ghost" loading={decline.isPending} onClick={() => decline.mutate()}>
        Decline
      </Button>
    </span>
  );
}

function RevokeConnection({ id, onDone }: { id: string; onDone: () => void }) {
  const { endpoints } = useApi();
  const toast = useToast();
  const revoke = useMutation({
    mutationFn: () => endpoints.revokeConnection(id),
    onSuccess: () => {
      toast.show({ tone: 'success', message: 'Connection revoked. No further records can cross.' });
      onDone();
    },
    onError: (error) => toast.show({ tone: 'danger', message: errorHint(error) }),
  });
  return (
    <Button size="sm" variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate()}>
      Revoke
    </Button>
  );
}

function ShareProjectForm({
  connections,
  onShared,
  deniedReason,
}: {
  connections: readonly Connection[];
  onShared: () => void;
  deniedReason?: string;
}) {
  const { endpoints } = useApi();
  const toast = useToast();
  const [connectionId, setConnectionId] = useState('');
  const [name, setName] = useState('');
  const [clientName, setClientName] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(newIdempotencyKey);

  const share = useMutation({
    mutationFn: () =>
      endpoints.shareNetworkProject(
        {
          connectionId,
          name,
          ...(clientName ? { clientName } : {}),
          ...(parseMoneyInput(value) !== null ? { contractValueMinor: parseMoneyInput(value) as number } : {}),
        },
        key,
      ),
    onSuccess: (project) => {
      toast.show({ tone: 'success', message: `${project.reference} shared.` });
      setName('');
      setClientName('');
      setValue('');
      setKey(newIdempotencyKey());
      onShared();
    },
    onError: (err) => toast.show({ tone: 'danger', message: errorHint(err) }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!connectionId) return setError('Choose a connected company.');
    if (name.trim().length < 2) return setError('Give the project a name.');
    if (value && parseMoneyInput(value) === null) return setError('Enter a contract value like 12500.00.');
    setError(null);
    share.mutate();
  };

  if (connections.length === 0) {
    return (
      <p className="web-muted">
        An active connection with the projects scope is required before a project can be shared.
      </p>
    );
  }

  return (
    <form className="web-card" onSubmit={submit} noValidate aria-labelledby="share-project-heading">
      <h3 id="share-project-heading">Share a project</h3>
      <Field label="With" required>
        <Select
          value={connectionId}
          placeholder="Choose a connected company"
          options={connections.map((c) => ({ value: c.id, label: c.partnerDisplayName }))}
          onChange={(e) => setConnectionId(e.target.value)}
        />
      </Field>
      <Field label="Project name" required>
        <TextInput value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Client" hint="Optional. A client name is not a login.">
        <TextInput value={clientName} maxLength={200} onChange={(e) => setClientName(e.target.value)} />
      </Field>
      <Field label="Contract value" hint="Optional, in dollars.">
        <TextInput inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
      </Field>
      {error && <p className="web-field-error" role="alert">{error}</p>}
      {share.error && <ErrorNotice error={share.error} title="The project was not shared" />}
      <GuardedButton type="submit" deniedReason={deniedReason} loading={share.isPending}>
        Share project
      </GuardedButton>
    </form>
  );
}
