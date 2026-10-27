'use client';

// PLT-015 team management: members, roles, invitations, deactivation and ownership transfer.
// Buttons the member's role does not allow stay visible with a plain explanation (PLT-015 A); the
// API evaluates the same policy on every request and is the authority (PLT-015 R).
import {
  MEMBER_ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type InvitationListSchema,
  type Member,
  type MemberRole,
} from '@fieldline/contracts';
import {
  Button,
  ConfirmDialog,
  DataTable,
  Field,
  Select,
  StatusPill,
  TextInput,
  useToast,
  type DataTableColumn,
} from '@fieldline/ui';
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { z } from 'zod';
import { useState, type FormEvent } from 'react';
import { ErrorNotice, GuardedButton, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { errorHint, isApiError, newIdempotencyKey } from '../../lib/api';
import { useDisplay } from '../../lib/display';
import { formatDate } from '../../lib/format';
import { orgKey, useApi, useSession } from '../../lib/session';

const ROLE_OPTIONS = MEMBER_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));
/** Ownership moves only through the transfer flow, never through the role picker. */
const ASSIGNABLE_ROLE_OPTIONS = ROLE_OPTIONS.filter((o) => o.value !== 'owner');

export function TeamView() {
  return (
    <RouteGate routeId="team">
      <TeamContent />
    </RouteGate>
  );
}

function conflictMessage(error: unknown): string {
  if (isApiError(error) && (error.is('precondition_failed') || error.is('revision_conflict'))) {
    return 'Someone else changed this member a moment ago. The list was reloaded; review it and try again.';
  }
  return errorHint(error);
}

function TeamContent() {
  const { endpoints } = useApi();
  const session = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const display = useDisplay();
  const membersKey = orgKey(session.orgId, 'team', 'members');
  const invitesKey = orgKey(session.orgId, 'team', 'invitations');
  const members = useQuery({ queryKey: membersKey, queryFn: () => endpoints.members() });
  const canInviteCheck = session.check('team:invite');
  const invitations = useQuery({
    queryKey: invitesKey,
    queryFn: () => endpoints.invitations(),
    enabled: canInviteCheck.allowed,
  });

  const roleCheck = session.check('team:update_role');
  const revokeCheck = session.check('team:revoke');
  const transferCheck = session.check('org:transfer_ownership');
  const [pendingRole, setPendingRole] = useState<Record<string, MemberRole>>({});
  const [deactivating, setDeactivating] = useState<Member | null>(null);

  const updateMember = useMutation({
    mutationFn: (input: {
      member: Member;
      patch: { role?: MemberRole; status?: Member['status'] };
    }) => endpoints.updateMember(input.member.id, input.patch, input.member.revision),
    onSuccess: (updated) => {
      toast.show({ tone: 'success', message: `${updated.displayName} updated.` });
      setPendingRole((p) => {
        const next = { ...p };
        delete next[updated.id];
        return next;
      });
    },
    onError: (error) => toast.show({ tone: 'danger', message: conflictMessage(error) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: membersKey }),
  });

  const selfUserId = session.me.user.id;
  const columns: DataTableColumn<Member>[] = [
    {
      id: 'name',
      header: 'Name',
      primary: true,
      cell: (m) => (
        <span>
          {m.displayName}
          {m.userId === selfUserId ? ' (you)' : ''}
          {m.email && <span className="web-muted web-small web-block">{m.email}</span>}
        </span>
      ),
      sortValue: (m) => m.displayName.toLowerCase(),
    },
    {
      id: 'role',
      header: 'Role',
      sortValue: (m) => MEMBER_ROLES.indexOf(m.role),
      cell: (m) => {
        const isSelf = m.userId === selfUserId;
        const reason = !roleCheck.allowed
          ? roleCheck.reason
          : m.role === 'owner'
            ? 'The owner role changes only through ownership transfer.'
            : isSelf
              ? 'You cannot change your own role.'
              : undefined;
        if (reason) {
          return (
            <span>
              {ROLE_LABELS[m.role]}
              <span className="web-denied-reason web-block">{reason}</span>
            </span>
          );
        }
        const chosen = pendingRole[m.id] ?? m.role;
        return (
          <span className="web-inline-form">
            <Field label={`Role for ${m.displayName}`} labelHidden>
              <Select
                value={chosen}
                options={ASSIGNABLE_ROLE_OPTIONS}
                onChange={(e) =>
                  setPendingRole((p) => ({ ...p, [m.id]: e.target.value as MemberRole }))
                }
              />
            </Field>
            {chosen !== m.role && (
              <Button
                size="sm"
                loading={updateMember.isPending && updateMember.variables?.member.id === m.id}
                onClick={() => updateMember.mutate({ member: m, patch: { role: chosen } })}
              >
                Save role
              </Button>
            )}
          </span>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      sortValue: (m) => m.status,
      cell: (m) => (
        <StatusPill
          status={m.status}
          label={m.status === 'suspended' ? 'Deactivated' : undefined}
          size="sm"
        />
      ),
    },
    {
      id: 'joined',
      header: 'Joined',
      sortValue: (m) => m.joinedAt,
      cell: (m) => formatDate(m.joinedAt, display.locale, display.timeZone),
    },
    {
      id: 'actions',
      header: 'Actions',
      cell: (m) => {
        if (m.role === 'owner' || m.userId === selfUserId)
          return <span className="web-muted web-small">-</span>;
        if (m.status === 'suspended') {
          return (
            <GuardedButton
              size="sm"
              variant="secondary"
              deniedReason={revokeCheck.allowed ? undefined : revokeCheck.reason}
              onClick={() => updateMember.mutate({ member: m, patch: { status: 'active' } })}
            >
              Reactivate
            </GuardedButton>
          );
        }
        if (m.status !== 'active') return <span className="web-muted web-small">Removed</span>;
        return (
          <GuardedButton
            size="sm"
            variant="danger"
            deniedReason={revokeCheck.allowed ? undefined : revokeCheck.reason}
            onClick={() => setDeactivating(m)}
          >
            Deactivate
          </GuardedButton>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader
        title="Team"
        description="Who can work in this company, and what each role may do. Changes take effect on each person's next request."
      />

      <section aria-labelledby="members-heading" className="web-section">
        <h2 id="members-heading">Members</h2>
        {members.error ? (
          <ErrorNotice
            error={members.error}
            title="Members could not be loaded"
            onRetry={() => void members.refetch()}
          />
        ) : (
          <DataTable
            caption="Team members"
            captionHidden
            columns={columns}
            rows={members.data?.items ?? []}
            rowKey={(m) => m.id}
            state={members.isPending ? { status: 'loading', label: 'Loading members' } : undefined}
            emptyTitle="No members yet"
            defaultSort={{ columnId: 'role', direction: 'asc' }}
          />
        )}
      </section>

      <section aria-labelledby="invite-heading" className="web-section">
        <h2 id="invite-heading">Invitations</h2>
        {canInviteCheck.allowed ? (
          <>
            <InviteForm
              onInvited={() => void queryClient.invalidateQueries({ queryKey: invitesKey })}
            />
            <InvitationList query={invitations} invitesKey={invitesKey} />
          </>
        ) : (
          <p className="web-denied-reason">{canInviteCheck.reason}</p>
        )}
      </section>

      <section aria-labelledby="owner-heading" className="web-section">
        <h2 id="owner-heading">Owner of record</h2>
        <TransferOwnership
          members={members.data?.items ?? []}
          deniedReason={transferCheck.allowed ? undefined : transferCheck.reason}
          onDone={() => void queryClient.invalidateQueries({ queryKey: membersKey })}
        />
      </section>

      <section aria-labelledby="roles-heading" className="web-section">
        <h2 id="roles-heading">What each role can do</h2>
        <dl className="web-role-guide">
          {MEMBER_ROLES.map((r) => (
            <div key={r}>
              <dt>{ROLE_LABELS[r]}</dt>
              <dd>{ROLE_DESCRIPTIONS[r]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <ConfirmDialog
        open={deactivating !== null}
        tone="danger"
        title={`Deactivate ${deactivating?.displayName ?? ''}?`}
        description="They lose access on their next request. Review tasks assigned to them are returned to the queue for reassignment, and approvals they had not finished are not counted. You can reactivate them later."
        confirmLabel="Deactivate"
        onCancel={() => setDeactivating(null)}
        onConfirm={async () => {
          if (!deactivating) return;
          await updateMember
            .mutateAsync({ member: deactivating, patch: { status: 'suspended' } })
            .catch(() => undefined);
          setDeactivating(null);
        }}
      />
    </>
  );
}

function InviteForm({ onInvited }: { onInvited: () => void }) {
  const { endpoints } = useApi();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole | ''>('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; role?: string }>({});
  // One key per invitation attempt: a retry after a network failure reuses it.
  const [key, setKey] = useState(newIdempotencyKey);
  const invite = useMutation({
    mutationFn: (input: { email: string; role: MemberRole }) =>
      endpoints.createInvitation(input, key),
    onSuccess: (inv) => {
      toast.show({ tone: 'success', message: `Invitation sent to ${inv.email}.` });
      setEmail('');
      setRole('');
      setKey(newIdempotencyKey());
      onInvited();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const errors: { email?: string; role?: string } = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      errors.email = 'Enter a valid email address.';
    if (!role) errors.role = 'Choose a role.';
    setFieldErrors(errors);
    if (errors.email || errors.role || !role) return;
    invite.mutate({ email: email.trim(), role });
  };
  return (
    <form className="web-card" onSubmit={submit} noValidate aria-labelledby="invite-form-heading">
      <h3 id="invite-form-heading">Invite a teammate</h3>
      <Field
        label="Email"
        required
        error={fieldErrors.email}
        hint="The invitation link is single-use and expires."
      >
        <TextInput
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field
        label="Role"
        required
        error={fieldErrors.role}
        hint={role ? ROLE_DESCRIPTIONS[role] : 'Review what the role can do before sending.'}
      >
        <Select
          value={role}
          placeholder="Choose a role"
          options={ASSIGNABLE_ROLE_OPTIONS}
          onChange={(e) => setRole(e.target.value as MemberRole | '')}
        />
      </Field>
      {invite.error && <ErrorNotice error={invite.error} title="The invitation was not sent" />}
      <Button type="submit" loading={invite.isPending}>
        Send invitation
      </Button>
    </form>
  );
}

function InvitationList({
  query,
  invitesKey,
}: {
  query: UseQueryResult<z.infer<typeof InvitationListSchema>>;
  invitesKey: unknown[];
}) {
  const { endpoints } = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const display = useDisplay();
  const revoke = useMutation({
    mutationFn: (id: string) => endpoints.revokeInvitation(id),
    onSuccess: () => toast.show({ tone: 'success', message: 'Invitation revoked.' }),
    onError: (e) => toast.show({ tone: 'danger', message: errorHint(e) }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: invitesKey }),
  });
  if (query.error)
    return (
      <ErrorNotice
        error={query.error}
        title="Invitations could not be loaded"
        onRetry={() => void query.refetch()}
      />
    );
  const pending = (query.data?.items ?? []).filter((i) => i.status === 'pending');
  if (query.isPending) return <p className="web-muted">Loading invitations…</p>;
  if (pending.length === 0) return <p className="web-muted">No pending invitations.</p>;
  return (
    <ul className="web-list" aria-label="Pending invitations">
      {pending.map((inv) => (
        <li key={inv.id}>
          <span>
            {inv.email} · {ROLE_LABELS[inv.role]} · expires{' '}
            {formatDate(inv.expiresAt, display.locale, display.timeZone)}
          </span>{' '}
          <Button
            size="sm"
            variant="ghost"
            loading={revoke.isPending && revoke.variables === inv.id}
            onClick={() => revoke.mutate(inv.id)}
          >
            Revoke
          </Button>
        </li>
      ))}
    </ul>
  );
}

function TransferOwnership({
  members,
  deniedReason,
  onDone,
}: {
  members: readonly Member[];
  deniedReason?: string;
  onDone: () => void;
}) {
  const { endpoints } = useApi();
  const session = useSession();
  const toast = useToast();
  const [target, setTarget] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [key] = useState(newIdempotencyKey);
  const owner = members.find((m) => m.role === 'owner');
  const candidates = members.filter((m) => m.status === 'active' && m.role !== 'owner');
  const chosen = candidates.find((m) => m.id === target);
  return (
    <div className="web-card">
      <p>
        {owner ? (
          <>
            <strong>{owner.displayName}</strong> is the owner of record. The owner controls
            ownership transfer and closing the company.
          </>
        ) : (
          'The owner of record controls ownership transfer and closing the company.'
        )}
      </p>
      {deniedReason ? (
        <p className="web-denied-reason">Only the owner can transfer ownership. {deniedReason}</p>
      ) : (
        <>
          <Field label="New owner" hint="They become Owner; you become Admin.">
            <Select
              value={target}
              placeholder="Choose an active member"
              options={candidates.map((m) => ({
                value: m.id,
                label: `${m.displayName} (${ROLE_LABELS[m.role]})`,
              }))}
              onChange={(e) => setTarget(e.target.value)}
            />
          </Field>
          <GuardedButton variant="danger" disabled={!chosen} onClick={() => setConfirming(true)}>
            Transfer ownership
          </GuardedButton>
        </>
      )}
      <ConfirmDialog
        open={confirming}
        tone="danger"
        title={`Make ${chosen?.displayName ?? ''} the owner?`}
        description="Ownership moves immediately and is recorded in the audit log. Only the new owner can transfer it back."
        confirmLabel="Transfer ownership"
        error={error ? errorHint(error) : undefined}
        onCancel={() => {
          setConfirming(false);
          setError(null);
        }}
        onConfirm={async () => {
          if (!chosen) return;
          try {
            await endpoints.transferOwnership(chosen.id, key);
            setConfirming(false);
            toast.show({ tone: 'success', message: `${chosen.displayName} is now the owner.` });
            onDone();
            // Our own permissions changed: refresh the session.
            await session.refresh();
          } catch (e) {
            setError(e);
          }
        }}
      />
    </div>
  );
}
