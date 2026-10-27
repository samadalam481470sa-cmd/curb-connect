'use client';

import { BRAND, ROLE_LABELS, type MeResponse } from '@fieldline/contracts';
import {
  AppShell,
  BottomNav,
  Breadcrumbs,
  Button,
  IconButton,
  Sheet,
  Sidebar,
  Skeleton,
  TopBar,
  type NavItem,
} from '@fieldline/ui';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { authFailureReason, isApiError } from '../../lib/api';
import { buildNavigation, bottomNavEntries, type NavEntry } from '../../lib/navigation';
import { clearShellCaches } from '../../lib/pwa';
import { breadcrumbTrail, matchRoute, primaryAncestor } from '../../lib/routing';
import { SessionProvider, accessPath, useApi, useMe, useSession } from '../../lib/session';
import { ErrorNotice } from '../common';
import { MenuIcon, NavIcon } from '../icons';
import { OutboxSync } from '../pwa/OutboxSync';
import { RouteAnnouncer } from './RouteAnnouncer';
import { SearchBox } from './SearchBox';
import { useClientNavigation } from './useClientNavigation';
import { WorkspaceSwitch } from './WorkspaceSwitch';

/** Where a signed-in user without an active workspace must go first (PLT-004 S, PLT-014). */
export function workspaceRedirect(me: MeResponse, returnTo: string): string | null {
  if (me.activeOrgId) return null;
  const active = me.memberships.filter((m) => m.status === 'active');
  if (active.length === 0) return '/onboarding';
  return `/select-workspace?returnTo=${encodeURIComponent(returnTo)}`;
}

/**
 * The signed-in frame. It renders nothing tenant-related until /v1/me confirms a session and an
 * active workspace; without one it redirects (sign-in, recovery page, workspace choice or first-run
 * setup) instead of showing stale content.
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const redirect = me.data ? workspaceRedirect(me.data, pathname) : null;

  useEffect(() => {
    if (redirect) router.replace(redirect);
  }, [redirect, router]);

  useEffect(() => {
    // The API client already redirects on 401/403 auth problems; this covers the first load.
    if (isApiError(me.error)) {
      const reason = authFailureReason(me.error);
      if (reason) router.replace(accessPath(reason, pathname));
    }
  }, [me.error, pathname, router]);

  if (me.isPending || redirect) {
    return (
      <div className="web-boot" aria-busy="true">
        <Skeleton label={`Loading ${BRAND.name}`} />
      </div>
    );
  }
  if (me.error) {
    return (
      <main className="web-boot" id="fl-main">
        <h1>{BRAND.name}</h1>
        <ErrorNotice
          error={me.error}
          title="Could not confirm your session"
          onRetry={() => void me.refetch()}
        />
      </main>
    );
  }
  return (
    <SessionProvider me={me.data}>
      <SignedInShell>{children}</SignedInShell>
    </SessionProvider>
  );
}

function toNavItems(entries: readonly NavEntry[]): NavItem[] {
  return entries.map((e) => ({
    id: e.id,
    label: e.label,
    href: e.href,
    current: e.current,
    icon: <NavIcon name={e.icon} />,
    unavailableReason: e.unavailableReason,
  }));
}

function SignedInShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const pathname = usePathname();
  const onClick = useClientNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);
  // Close the phone menu after navigating (state adjusted during render, not in an effect).
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  const route = matchRoute(pathname);
  const entries = useMemo(
    () =>
      buildNavigation({
        can: session.can,
        flag: session.flag,
        currentPrimaryId: route ? primaryAncestor(route).id : null,
      }),
    [session, route],
  );
  const items = toNavItems(entries);
  const bottomItems = toNavItems(bottomNavEntries(entries));
  const membership = session.me.memberships.find((m) => m.orgId === session.me.activeOrgId);
  const crumbs = route ? breadcrumbTrail(route) : [];

  return (
    <div onClick={onClick} className="web-shell-root">
      <AppShell
        topBar={
          <TopBar
            start={
              <>
                <span className="web-phone-only">
                  <IconButton
                    label="Open menu"
                    icon={<MenuIcon />}
                    onClick={() => setMenuOpen(true)}
                  />
                </span>
                <a className="web-brand" href="/">
                  {BRAND.name}
                </a>
                <WorkspaceSwitch me={session.me} />
              </>
            }
            end={
              <>
                <span className="web-desktop-only">
                  <SearchBox />
                </span>
                <span className="web-role" title="Your role in this company">
                  {membership ? ROLE_LABELS[membership.role] : null}
                </span>
                <SignOutButton />
              </>
            }
          />
        }
        sidebar={<Sidebar items={items} label="Main" />}
        bottomNav={<BottomNav items={bottomItems} label="Main (phone)" />}
      >
        <OutboxSync />
        {crumbs.length > 1 && <Breadcrumbs items={crumbs} />}
        <div className="web-content">{children}</div>
      </AppShell>
      <RouteAnnouncer />
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" side="left">
        <div onClick={onClick}>
          <SearchBox compact />
          <Sidebar items={items} label="All areas" />
        </div>
      </Sheet>
    </div>
  );
}

function SignOutButton() {
  const { endpoints } = useApi();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={busy}
      onClick={async () => {
        setBusy(true);
        let serverConfirmed = true;
        try {
          await endpoints.logout();
        } catch {
          // Offline or the API is down: clear this device anyway; the server session still
          // expires on its idle timeout.
          serverConfirmed = false;
        }
        queryClient.clear();
        await clearShellCaches();
        router.replace(`/sign-in?reason=${serverConfirmed ? 'signed_out' : 'signed_out_offline'}`);
      }}
    >
      Sign out
    </Button>
  );
}
