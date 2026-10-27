'use client';

import { BRAND, ROLE_LABELS } from '@fieldline/contracts';
import { Button, Skeleton } from '@fieldline/ui';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { ButtonLink, ErrorNotice } from '../../components/common';
import { safeReturnTo } from '../../lib/routing';
import { useMe, useSwitchWorkspace } from '../../lib/session';

/**
 * PLT-004 S / PLT-013 B: a person in several companies always picks one explicitly. Each company
 * is a separate workspace; the app never shows a merged view of their records.
 */
export function SelectWorkspaceView() {
  const params = useSearchParams();
  const returnTo = safeReturnTo(params.get('returnTo'));
  const me = useMe();
  const switchWorkspace = useSwitchWorkspace();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const active = me.data?.memberships.filter((m) => m.status === 'active') ?? [];
  return (
    <main id="fl-main" className="web-auth" tabIndex={-1}>
      <div className="web-auth__card">
        <p className="web-brand web-brand--large">{BRAND.name}</p>
        <h1>Choose a company</h1>
        <p className="web-muted">
          You belong to more than one company. Each one is a separate workspace with its own
          records, team and settings.
        </p>
        {me.isPending ? (
          <Skeleton label="Loading your companies" />
        ) : me.error ? (
          <ErrorNotice error={me.error} onRetry={() => void me.refetch()} />
        ) : active.length === 0 ? (
          <>
            <p>You are not an active member of any company yet.</p>
            <ButtonLink href="/onboarding">Set up a new company</ButtonLink>
          </>
        ) : (
          <ul className="web-choice-list" aria-label="Your companies">
            {active.map((m) => (
              <li key={m.membershipId}>
                <Button
                  variant={m.orgId === me.data.activeOrgId ? 'primary' : 'secondary'}
                  fullWidth
                  size="lg"
                  loading={pending === m.orgId}
                  disabled={pending !== null && pending !== m.orgId}
                  onClick={async () => {
                    setPending(m.orgId);
                    setError(null);
                    try {
                      await switchWorkspace(m.orgId, returnTo);
                    } catch (e) {
                      setError(e);
                      setPending(null);
                    }
                  }}
                >
                  {m.orgDisplayName}
                  <span className="web-choice-detail">
                    {ROLE_LABELS[m.role]}
                    {m.orgId === me.data.activeOrgId ? ' · current' : ''}
                  </span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {error !== null && <ErrorNotice error={error} title="Could not open that company" />}
      </div>
    </main>
  );
}
