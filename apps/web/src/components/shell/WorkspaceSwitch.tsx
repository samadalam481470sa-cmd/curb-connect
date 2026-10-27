'use client';

import { ROLE_LABELS, type MeResponse } from '@fieldline/contracts';
import { WorkspaceSwitcher, useToast } from '@fieldline/ui';
import { errorHint } from '../../lib/api';
import { useSwitchWorkspace } from '../../lib/session';

/** Active memberships only; suspended and revoked companies are never offered. */
export function switchableWorkspaces(me: MeResponse) {
  return me.memberships
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.orgId, name: m.orgDisplayName, detail: ROLE_LABELS[m.role] }));
}

/**
 * Global workspace switcher (PLT-011 B). Each company is a separate workspace: switching asks the
 * API to change the session's active org, then clears every cached record before showing the
 * new one, so records from two companies are never merged on screen (PLT-004 S).
 */
export function WorkspaceSwitch({ me }: { me: MeResponse }) {
  const switchWorkspace = useSwitchWorkspace();
  const toast = useToast();
  const workspaces = switchableWorkspaces(me);
  if (!me.activeOrgId || workspaces.length === 0) return null;
  return (
    <WorkspaceSwitcher
      workspaces={workspaces}
      currentId={me.activeOrgId}
      label="Switch company workspace"
      onSwitch={(orgId) => {
        switchWorkspace(orgId).catch((error: unknown) =>
          toast.show({
            tone: 'danger',
            message: `Could not switch workspace. ${errorHint(error)}`,
          }),
        );
      }}
    />
  );
}
