'use client';

import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '../icons';
import { cx } from '../internal/cx';
import { useControllableState } from '../internal/useControllableState';

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon?: ReactNode;
  current?: boolean;
  /** Visible but unavailable (feature flag off or role lacks permission). */
  unavailableReason?: string;
  badge?: ReactNode;
}

/**
 * Page frame: skip link, top bar, optional sidebar (desktop) and bottom nav (phones). The main
 * region reserves space for the bottom navigation so content and risk notices never sit beneath
 * it (PLT-012 safety rule).
 */
export function AppShell({
  topBar,
  sidebar,
  bottomNav,
  children,
  mainId = 'fl-main',
  footer,
}: {
  topBar?: ReactNode;
  sidebar?: ReactNode;
  bottomNav?: ReactNode;
  children: ReactNode;
  mainId?: string;
  /** Rendered after the main region (policy links, small print), outside the landmark. */
  footer?: ReactNode;
}) {
  return (
    <div
      className={cx(
        'fl-shell',
        sidebar !== undefined && 'fl-shell--with-sidebar',
        bottomNav !== undefined && 'fl-shell--with-bottom-nav',
      )}
    >
      <a className="fl-skip-link" href={`#${mainId}`}>
        Skip to main content
      </a>
      {topBar}
      {sidebar}
      <main id={mainId} className="fl-shell__main" tabIndex={-1}>
        {children}
      </main>
      {footer}
      {bottomNav}
    </div>
  );
}

export function TopBar({
  start,
  title,
  end,
}: {
  start?: ReactNode;
  title?: ReactNode;
  end?: ReactNode;
}) {
  return (
    <header className="fl-topbar">
      <div className="fl-topbar__start">{start}</div>
      {title && <div className="fl-topbar__title">{title}</div>}
      <div className="fl-topbar__end">{end}</div>
    </header>
  );
}

function NavLink({ item, className }: { item: NavItem; className: string }) {
  const reasonId = useId();
  if (item.unavailableReason) {
    return (
      <span
        className={cx(className, `${className}--unavailable`)}
        aria-disabled="true"
        aria-describedby={reasonId}
      >
        {item.icon && <span aria-hidden="true">{item.icon}</span>}
        <span>{item.label}</span>
        <span
          id={reasonId}
          className="fl-visually-hidden"
        >{`Not available: ${item.unavailableReason}`}</span>
      </span>
    );
  }
  return (
    <a className={className} href={item.href} aria-current={item.current ? 'page' : undefined}>
      {item.icon && <span aria-hidden="true">{item.icon}</span>}
      <span>{item.label}</span>
      {item.badge !== undefined && <span className="fl-nav__badge">{item.badge}</span>}
    </a>
  );
}

export function Sidebar({
  items,
  label = 'Main',
  header,
  footer,
}: {
  items: readonly NavItem[];
  label?: string;
  header?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <nav className="fl-sidebar" aria-label={label}>
      {header}
      <ul className="fl-sidebar__list">
        {items.map((item) => (
          <li key={item.id}>
            <NavLink item={item} className="fl-sidebar__link" />
          </li>
        ))}
      </ul>
      {footer}
    </nav>
  );
}

export interface NavTreeGroupData {
  id: string;
  label: string;
  items: readonly NavItem[];
}

export interface NavTreeSectionData {
  id: string;
  /** null renders the items directly, with no collapsible header (the top-level group). */
  label: string | null;
  items: readonly NavItem[];
  groups?: readonly NavTreeGroupData[];
}

function sectionHasCurrent(section: NavTreeSectionData): boolean {
  return (
    section.items.some((i) => i.current) ||
    (section.groups ?? []).some((g) => g.items.some((i) => i.current))
  );
}

/**
 * Collapsible navigation tree: sections (and subsections within them) toggle open and closed
 * with disclosure buttons (`aria-expanded`), so a long area list stays scannable on desktop and
 * in the phone menu sheet. The section containing the current page is always expanded when the
 * current page changes. Arrow keys move between the toggles and links; Tab order is unchanged.
 * Collapsed state can be controlled by the caller (e.g. persisted per user) or left internal.
 */
export function NavTree({
  sections,
  label = 'Main',
  header,
  footer,
  collapsedIds,
  defaultCollapsedIds,
  onCollapsedChange,
}: {
  sections: readonly NavTreeSectionData[];
  label?: string;
  header?: ReactNode;
  footer?: ReactNode;
  /** Controlled set of collapsed section ids (subsections use `<sectionId>:<groupId>`). */
  collapsedIds?: readonly string[];
  defaultCollapsedIds?: readonly string[];
  onCollapsedChange?: (collapsedIds: string[]) => void;
}) {
  const [collapsed, setCollapsed] = useControllableState<readonly string[]>(
    collapsedIds,
    defaultCollapsedIds ?? [],
    onCollapsedChange ? (next) => onCollapsedChange([...next]) : undefined,
  );
  const navRef = useRef<HTMLElement>(null);

  // When the current page moves into a collapsed section, expand that section so the current
  // link is never hidden (state adjusted during render, matching the shell's other patterns).
  const currentSection = sections.find(sectionHasCurrent);
  const [seenCurrentSection, setSeenCurrentSection] = useState(currentSection?.id);
  if (currentSection && currentSection.id !== seenCurrentSection) {
    setSeenCurrentSection(currentSection.id);
    if (collapsed.includes(currentSection.id)) {
      setCollapsed(collapsed.filter((id) => id !== currentSection.id));
    }
  }

  const toggle = useCallback(
    (id: string) => {
      setCollapsed(
        collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id],
      );
    },
    [collapsed, setCollapsed],
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const root = navRef.current;
    if (!root) return;
    const focusable = [
      ...root.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'),
    ].filter((el) => el.offsetParent !== null || el === document.activeElement);
    if (focusable.length === 0) return;
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    let next: HTMLElement | undefined;
    if (event.key === 'Home') next = focusable[0];
    else if (event.key === 'End') next = focusable[focusable.length - 1];
    else if (event.key === 'ArrowDown') next = focusable[Math.min(index + 1, focusable.length - 1)];
    else next = focusable[Math.max(index - 1, 0)];
    if (next && next !== document.activeElement) {
      event.preventDefault();
      next.focus();
    }
  };

  return (
    <nav ref={navRef} className="fl-sidebar fl-navtree" aria-label={label} onKeyDown={onKeyDown}>
      {header}
      {sections.map((section) => (
        <NavTreeSection
          key={section.id}
          section={section}
          collapsed={collapsed}
          onToggle={toggle}
        />
      ))}
      {footer}
    </nav>
  );
}

function NavTreeSection({
  section,
  collapsed,
  onToggle,
}: {
  section: NavTreeSectionData;
  collapsed: readonly string[];
  onToggle: (id: string) => void;
}) {
  const listId = useId();
  if (section.label === null) {
    return (
      <ul className="fl-sidebar__list fl-navtree__list">
        {section.items.map((item) => (
          <li key={item.id}>
            <NavLink item={item} className="fl-sidebar__link" />
          </li>
        ))}
      </ul>
    );
  }
  const expanded = !collapsed.includes(section.id);
  return (
    <div className="fl-navtree__section">
      <button
        type="button"
        className="fl-navtree__toggle"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => onToggle(section.id)}
      >
        <span>{section.label}</span>
        {expanded ? <ChevronDownIcon size={16} /> : <ChevronRightIcon size={16} />}
      </button>
      <div id={listId} hidden={!expanded}>
        {section.items.length > 0 && (
          <ul className="fl-sidebar__list fl-navtree__list">
            {section.items.map((item) => (
              <li key={item.id}>
                <NavLink item={item} className="fl-sidebar__link" />
              </li>
            ))}
          </ul>
        )}
        {(section.groups ?? []).map((group) => (
          <NavTreeGroup
            key={group.id}
            sectionId={section.id}
            group={group}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function NavTreeGroup({
  sectionId,
  group,
  collapsed,
  onToggle,
}: {
  sectionId: string;
  group: NavTreeGroupData;
  collapsed: readonly string[];
  onToggle: (id: string) => void;
}) {
  const listId = useId();
  const toggleId = `${sectionId}:${group.id}`;
  const expanded = !collapsed.includes(toggleId);
  return (
    <div className="fl-navtree__group">
      <button
        type="button"
        className="fl-navtree__group-toggle"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => onToggle(toggleId)}
      >
        <span>{group.label}</span>
        {expanded ? <ChevronDownIcon size={14} /> : <ChevronRightIcon size={14} />}
      </button>
      <ul id={listId} className="fl-sidebar__list fl-navtree__list" hidden={!expanded}>
        {group.items.map((item) => (
          <li key={item.id}>
            <NavLink item={item} className="fl-sidebar__link" />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Phone navigation: at most five destinations, each a 44px+ target. */
export function BottomNav({
  items,
  label = 'Main',
}: {
  items: readonly NavItem[];
  label?: string;
}) {
  return (
    <nav className="fl-bottomnav" aria-label={label}>
      <ul className="fl-bottomnav__list">
        {items.slice(0, 5).map((item) => (
          <li key={item.id}>
            <NavLink item={item} className="fl-bottomnav__link" />
          </li>
        ))}
      </ul>
    </nav>
  );
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

export function Breadcrumbs({
  items,
  label = 'Breadcrumb',
}: {
  items: readonly BreadcrumbItem[];
  label?: string;
}) {
  return (
    <nav aria-label={label} className="fl-breadcrumbs">
      <ol className="fl-breadcrumbs__list">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${index}-${item.label}`} className="fl-breadcrumbs__item">
              {last || !item.href ? (
                <span aria-current={last ? 'page' : undefined}>{item.label}</span>
              ) : (
                <a href={item.href}>{item.label}</a>
              )}
              {!last && <ChevronRightIcon size={14} className="fl-breadcrumbs__sep" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface Workspace {
  id: string;
  name: string;
  /** e.g. role in that workspace, shown under the name. */
  detail?: string;
}

/**
 * Disclosure-style workspace (organization) switcher. Uses a list of buttons rather than an ARIA
 * menu so it works the same with touch, keyboard and screen readers. Escape closes it.
 */
export function WorkspaceSwitcher({
  workspaces,
  currentId,
  onSwitch,
  label = 'Switch workspace',
}: {
  workspaces: readonly Workspace[];
  currentId: string;
  onSwitch: (id: string) => void;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const current = workspaces.find((w) => w.id === currentId);
  return (
    <div
      className="fl-workspace"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="fl-workspace__trigger"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="fl-visually-hidden">{`${label}. Current: `}</span>
        <span>{current?.name ?? 'No workspace'}</span>
        <ChevronDownIcon size={16} />
      </button>
      <ul id={listId} className="fl-workspace__list" hidden={!open} aria-label={label}>
        {workspaces.map((w) => (
          <li key={w.id}>
            <button
              type="button"
              className="fl-workspace__option"
              aria-current={w.id === currentId ? 'true' : undefined}
              onClick={() => {
                setOpen(false);
                if (w.id !== currentId) onSwitch(w.id);
                triggerRef.current?.focus();
              }}
            >
              <span>{w.name}</span>
              {w.detail && <span className="fl-workspace__detail">{w.detail}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
