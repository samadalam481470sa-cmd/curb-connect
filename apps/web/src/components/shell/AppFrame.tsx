'use client';

import { BRAND, ROLE_LABELS, type MeResponse } from '@fieldline/contracts';
import {
  AppShell,
  BottomNav,
  Breadcrumbs,
  Button,
  IconButton,
  NavTree,
  Sheet,
  Skeleton,
  TopBar,
  type NavItem,
  type NavTreeSectionData,
} from '@fieldline/ui';
import { useQueryClient } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { authFailureReason, isApiError } from '../../lib/api';
import {
  buildNavigation,
  buildNavigationTree,
  bottomNavEntries,
  type NavEntry,
} from '../../lib/navigation';
import { useNavCollapsed } from '../../lib/preferences';
import { clearShellCaches } from '../../lib/pwa';
import { breadcrumbTrail, matchRoute, primaryAncestor } from '../../lib/routing';
import { SessionProvider, accessPath, useApi, useMe, useSession } from '../../lib/session';
import { useAutoWakeApi } from '../../lib/wake';
import { ErrorNotice } from '../common';
import { MenuIcon, NavIcon } from '../icons';
import { OutboxSync } from '../pwa/OutboxSync';
import { NativeDeviceBridge } from '../native/NativeDeviceBridge';
import { SiteFooter } from '../site/SiteFooter';
import { RouteAnnouncer } from './RouteAnnouncer';
import { SearchBox } from './SearchBox';
import { useClientNavigation } from './useClientNavigation';
import { CommandStatus } from './CommandStatus';
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
  // First load with the API asleep: wake it instead of showing "Could not confirm your session".
  const wakingApi = useAutoWakeApi(me.data ? null : me.error);

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

  if (me.isPending || redirect || wakingApi) {
    return (
      <div className="web-boot" aria-busy="true" aria-live="polite">
        <section style={{ width: '100%', maxWidth: 440, padding: 24, borderRadius: 16, textAlign: 'center', color: '#e6f1ff', background: 'rgba(12,22,36,.9)', border: '1px solid rgba(94,214,255,.3)' }}>
          <h1>{BRAND.name}</h1>
          <p role="status">
            {wakingApi
              ? 'Starting the server. This takes about a minute.'
              : 'Connecting to your workspace…'}
          </p>
          <Skeleton label={`Loading ${BRAND.name}`} />
          <p style={{ color: '#a6c2d8', fontSize: 14, lineHeight: 1.6 }}>
            Your hosting service may take longer to start on the first visit.
          </p>
          <a href="/sign-in" style={{ color: '#67e8f9' }}>Open sign-in if this screen stays here</a>
        </section>
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
  const extraItems: NavItem[] = [
    ...(session.can('org:read') ? [{ id: 'enterprise', label: 'Enterprise Suite', href: '/enterprise',
      current: pathname === '/enterprise' || pathname.startsWith('/enterprise/'),
      icon: <NavIcon name="build" /> }] : []),
    ...(session.can('invoice:read') ? [{
      id: 'invoice-master', label: 'Invoice Dashboard', href: '/invoice-dashboard',
      current: pathname === '/invoice-dashboard', icon: <NavIcon name="receipt" />,
    }] : []),
  ];
  const treeSections = useMemo<NavTreeSectionData[]>(() => {
    const sections = buildNavigationTree({
      can: session.can,
      flag: session.flag,
      currentPrimaryId: route ? primaryAncestor(route).id : null,
    }).map((section) => ({
      id: section.id,
      label: section.label,
      items: toNavItems(section.entries),
      groups: section.groups.map((group) => ({
        id: group.id,
        label: group.label,
        items: toNavItems(group.entries),
      })),
    }));
    if (extraItems.length > 0) {
      sections.push({ id: 'more', label: null, items: extraItems, groups: [] });
    }
    return sections;
    // extraItems is rebuilt each render from session/pathname; session + route cover it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, route, pathname]);
  const [persistedCollapsed, setPersistedCollapsed] = useNavCollapsed();
  // Phone menu first open: only the section holding the current page starts expanded.
  const phoneDefaultCollapsed = treeSections
    .filter((s) => s.label !== null)
    .filter(
      (s) =>
        !s.items.some((i) => i.current) &&
        !(s.groups ?? []).some((g) => g.items.some((i) => i.current)),
    )
    .map((s) => s.id);
  // Five-item phone bar: surface Invoices for authorized users without removing
  // Settings from the sidebar/drawer. Keep the original order for every other role.
  const defaultBottom = bottomNavEntries(entries);
  const invoiceShortcut: NavEntry | null = session.can('invoice:read')
    ? {
        id: 'mobile-invoices',
        label: 'Invoices',
        href: '/invoice-dashboard',
        icon: 'receipt',
        current: pathname === '/invoice-dashboard' || pathname === '/billing',
        mobile: true,
      }
    : null;
  const bottomEntries = invoiceShortcut
    ? [...defaultBottom.filter((item) => item.id !== 'settings').slice(0, 4), invoiceShortcut]
    : defaultBottom;
  // Keep the five-slot phone bar intact. The active Lawn Care workspace gets
  // a contextual tab while every other area remains reachable in the menu.
  const contextualBottom = pathname === '/bidding' ? bottomEntries.map(item =>
    item.id === 'jobs' ? { ...item, id: 'mobile-bidding', label: 'Bidding', href: '/bidding',
      icon: 'board', current: true } : item) :
    pathname === '/lawn' ? bottomEntries.map(item =>
      item.id === 'jobs' ? { ...item, id: 'mobile-lawn', label: 'Lawn Care',
        href: '/lawn', icon: 'lawn', current: true } : item) : bottomEntries;
  const bottomItems = toNavItems(contextualBottom);
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
                <CommandStatus orgName={membership?.orgDisplayName} />
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
        sidebar={
          <NavTree
            sections={treeSections}
            label="Main"
            collapsedIds={persistedCollapsed ?? undefined}
            defaultCollapsedIds={[]}
            onCollapsedChange={setPersistedCollapsed}
          />
        }
        bottomNav={<BottomNav items={bottomItems} label="Main (phone)" />}
        footer={<SiteFooter compact />}
      >
        <OutboxSync />
        <NativeDeviceBridge />
        {crumbs.length > 1 && <Breadcrumbs items={crumbs} />}
        <div className="web-content">{children}</div>
      </AppShell>
      <RouteAnnouncer />
      <Sheet open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu" side="left">
        <div onClick={onClick}>
          <SearchBox compact />
          <NavTree
            sections={treeSections}
            label="All areas"
            collapsedIds={persistedCollapsed ?? undefined}
            defaultCollapsedIds={phoneDefaultCollapsed}
            onCollapsedChange={setPersistedCollapsed}
          />
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
