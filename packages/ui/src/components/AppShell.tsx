'use client';

import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDownIcon, ChevronRightIcon } from '../icons';
import { cx } from '../internal/cx';

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
}: {
  topBar?: ReactNode;
  sidebar?: ReactNode;
  bottomNav?: ReactNode;
  children: ReactNode;
  mainId?: string;
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
