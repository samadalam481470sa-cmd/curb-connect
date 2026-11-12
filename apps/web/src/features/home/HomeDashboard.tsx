'use client';

import {
  BRAND,
  type DASHBOARD_QUEUES,
  getRoute,
  type DashboardResponseSchema,
  ROLE_LABELS,
  type RouteId,
} from '@fieldline/contracts';
import { CurbIcon, RoofIcon, StatusPill } from '@fieldline/ui';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import type { z } from 'zod';
import { ErrorNotice } from '../../components/common';
import { BuildIcon, GridIcon, PriceTagIcon } from '../../components/icons';
import { RouteGate } from '../../components/RouteGate';
import { SearchBox } from '../../components/shell/SearchBox';
import { isApiError } from '../../lib/api';
import { formatDateTime, formatRelative } from '../../lib/format';
import { useDisplay } from '../../lib/display';
import { orgKey, useApi, useSession } from '../../lib/session';
import { MaterialLookup } from '../command/MaterialLookup';
import { BillingMasterSummary } from '../billing/BillingMasterSummary';
import { WidgetGrid, type WidgetDef } from '../command/WidgetGrid';

type Dashboard = z.infer<typeof DashboardResponseSchema>;
type QueueKey = (typeof DASHBOARD_QUEUES)[number];

/** PLT-016 B: urgent human-review and blocking items come before everything else. */
export const QUEUE_ORDER: readonly QueueKey[] = [
  'roof_reviews',
  'curb_reviews',
  'estimates_awaiting_approval',
  'dispatch_blocked',
  'permits_expiring',
  'invoices_overdue',
  'proposals_awaiting_response',
  'leads_new',
  'my_tasks',
];

export const QUEUE_LABELS: Record<QueueKey, string> = {
  roof_reviews: 'Roof reports awaiting review',
  curb_reviews: 'Curb estimates awaiting measurements or review',
  estimates_awaiting_approval: 'Estimates awaiting approval',
  dispatch_blocked: 'Jobs blocked from dispatch',
  permits_expiring: 'Permits expiring soon',
  invoices_overdue: 'Unpaid invoices',
  proposals_awaiting_response: 'Proposals awaiting response',
  leads_new: 'New leads',
  my_tasks: 'My tasks',
};

const URGENT: ReadonlySet<QueueKey> = new Set([
  'roof_reviews',
  'curb_reviews',
  'estimates_awaiting_approval',
  'dispatch_blocked',
  'permits_expiring',
]);

/** Endpoint missing or feature off: the honest state is "no data yet", not an error. */
function isNotAvailable(error: unknown): boolean {
  return (
    isApiError(error) &&
    error.kind === 'problem' &&
    (error.is('not_found') || error.is('feature_unavailable') || error.is('method_not_allowed'))
  );
}

export function HomeDashboard() {
  return (
    <RouteGate routeId="home">
      <HomeContent />
    </RouteGate>
  );
}

function HomeContent() {
  const { endpoints } = useApi();
  const session = useSession();
  const { locale, timeZone } = useDisplay();
  const membership = session.me.memberships.find((m) => m.orgId === session.orgId);
  const dashboard = useQuery({
    queryKey: orgKey(session.orgId, 'dashboard'),
    queryFn: () => endpoints.dashboard(),
    retry: false,
  });
  const checkedAt = dashboard.dataUpdatedAt || dashboard.errorUpdatedAt;

  const widgets: WidgetDef[] = [
    {
      id: 'twin',
      title: 'Operations twin',
      defaultSize: 'xl',
      render: () => <OperationsTwin orgName={membership?.orgDisplayName} />,
    },
    {
      id: 'launch',
      title: 'Start work',
      defaultSize: 'l',
      render: () => (
        <div className="cc-launch" aria-labelledby="products-heading">
          <h2 id="products-heading" className="cc-sr-only">
            Start work
          </h2>
          <ProductCard routeId="roof" icon={<RoofIcon size={26} />} />
          <ProductCard routeId="curb" icon={<CurbIcon size={26} />} />
          <ProductCard routeId="build" icon={<BuildIcon size={26} />} />
          <ProductCard routeId="plumbing" icon={<GridIcon size={26} />} />
        </div>
      ),
    },
    {
      id: 'status',
      title: 'System status',
      defaultSize: 's',
      render: () => <SystemStatus role={membership ? ROLE_LABELS[membership.role] : undefined} />,
    },
    {
      id: 'queues',
      title: 'Needs attention',
      defaultSize: 'xl',
      actions:
        checkedAt > 0 ? (
          <span className="cc-chip" aria-live="polite">
            {dashboard.data
              ? `UPDATED ${formatRelative(dashboard.data.generatedAt, locale).toUpperCase()}`
              : `CHECKED ${formatDateTime(new Date(checkedAt).toISOString(), locale, timeZone)}`}
          </span>
        ) : undefined,
      render: () => (
        <section aria-labelledby="queues-heading">
          <h2 id="queues-heading" className="cc-sr-only">
            Needs attention
          </h2>
          {dashboard.isPending ? (
            <div className="cc-stack" style={{ gap: 8 }} aria-busy="true">
              <p className="cc-sr-only">Loading queues…</p>
              <div className="cc-skeleton" style={{ height: 70 }} />
              <div className="cc-skeleton" style={{ height: 70 }} />
            </div>
          ) : dashboard.error && !isNotAvailable(dashboard.error) ? (
            <ErrorNotice
              error={dashboard.error}
              title="Queues could not be loaded"
              onRetry={() => void dashboard.refetch()}
            />
          ) : (
            <QueueList data={dashboard.data ?? null} />
          )}
        </section>
      ),
    },
    {
      id: 'materials',
      title: 'Material price scanner',
      defaultSize: 'm',
      actions: <PriceTagIcon size={18} />,
      render: () => <MaterialLookup />,
    },
    {
      id: 'quick',
      title: 'Quick create',
      defaultSize: 'm',
      render: () => <QuickCreate />,
    },
  ];

  return (
    <>
      <header className="cc-page-head">
        <div>
          <div className="cc-eyebrow">Command center</div>
          <h1 tabIndex={-1} data-route-heading="">
            Home
          </h1>
          {membership && <p>{membership.orgDisplayName}</p>}
        </div>
        <div className="web-phone-only web-block" style={{ width: '100%' }}>
          <SearchBox />
        </div>
      </header>
      <WidgetGrid storageKey={`fieldpro.home.layout.v1.${session.orgId}`} widgets={widgets} />
      <BillingMasterSummary />
    </>
  );
}

const PRODUCT_BLURBS: Partial<Record<RouteId, string>> = {
  roof: 'Facet sketching, pitch, sloped area, squares and materials.',
  curb: 'Cut path, profile, low/base/high pricing with permit and utility gates.',
  build: 'Footprint to floor plan, full material takeoff and cheapest-supplier pricing.',
  plumbing: 'Fixture schedule, pipe runs, takeoff and a preliminary proposal.',
};

function ProductCard({ routeId, icon }: { routeId: RouteId; icon: ReactNode }) {
  const session = useSession();
  const route = getRoute(routeId);
  const permission = session.check(route.permission);
  const flagOn = !route.featureFlag || session.flag(route.featureFlag);
  const unavailable = !permission.allowed
    ? permission.reason
    : !flagOn
      ? 'Not enabled for your company yet.'
      : null;
  const body = (
    <>
      <span className="cc-launch__icon" aria-hidden="true">
        {icon}
      </span>
      <h3
        className="cc-launch__name"
        id={`product-${routeId}`}
        style={{ margin: 0, fontSize: '1rem' }}
      >
        {route.label}
      </h3>
      <span className="cc-launch__desc">{PRODUCT_BLURBS[routeId]}</span>
      {unavailable ? (
        <span className="web-denied-reason">{unavailable}</span>
      ) : (
        <span className="cc-eyebrow" style={{ marginTop: 'auto' }}>
          Open {route.label} →
        </span>
      )}
    </>
  );
  return unavailable ? (
    <article
      className="cc-launch__item"
      aria-disabled="true"
      aria-labelledby={`product-${routeId}`}
    >
      {body}
    </article>
  ) : (
    <a className="cc-launch__item" href={route.path} aria-labelledby={`product-${routeId}`}>
      {body}
    </a>
  );
}

function QuickCreate() {
  const session = useSession();
  const items: { routeId: RouteId; label: string }[] = [
    { routeId: 'build', label: 'New house estimate' },
    { routeId: 'roof', label: 'Roof takeoff' },
    { routeId: 'curb', label: 'Curb estimate' },
    { routeId: 'plumbing', label: 'Plumbing rough-in' },
    { routeId: 'leads', label: 'Leads inbox' },
  ];
  const visible = items.filter(({ routeId }) => {
    const route = getRoute(routeId);
    return (
      session.check(route.permission).allowed &&
      (!route.featureFlag || session.flag(route.featureFlag))
    );
  });
  if (visible.length === 0)
    return <p className="web-muted">Nothing available for your role yet.</p>;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {visible.map((i) => (
        <a key={i.routeId} className="cc-btn cc-btn--sm" href={getRoute(i.routeId).path}>
          + {i.label}
        </a>
      ))}
    </div>
  );
}

function SystemStatus({ role }: { role?: string }) {
  const [state, setState] = useState<{ online: boolean; tz: string; time: string } | null>(null);
  useEffect(() => {
    const read = () =>
      setState({
        online: navigator.onLine,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    read();
    const t = window.setInterval(read, 30_000);
    window.addEventListener('online', read);
    window.addEventListener('offline', read);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('online', read);
      window.removeEventListener('offline', read);
    };
  }, []);
  if (!state) return <div className="cc-skeleton" style={{ height: 90 }} />;
  return (
    <dl style={{ margin: 0 }}>
      <div className="cc-total">
        <dt>Link</dt>
        <dd>
          <span className={state.online ? 'cc-dot' : 'cc-dot cc-dot--warn'} aria-hidden="true" />{' '}
          {state.online ? 'Online' : 'Offline (changes queue locally)'}
        </dd>
      </div>
      <div className="cc-total">
        <dt>Local time</dt>
        <dd>{state.time}</dd>
      </div>
      <div className="cc-total">
        <dt>Time zone</dt>
        <dd>{state.tz}</dd>
      </div>
      {role && (
        <div className="cc-total">
          <dt>Your role</dt>
          <dd>{role}</dd>
        </div>
      )}
    </dl>
  );
}

/** Decorative isometric site model with live session context (no invented numbers). */
function OperationsTwin({ orgName }: { orgName?: string }) {
  return (
    <div className="cc-split cc-split--wide-left" style={{ alignItems: 'center' }}>
      <div className="cc-blueprint" style={{ minHeight: 240 }}>
        <svg viewBox="0 0 400 230" aria-hidden="true" focusable="false">
          <defs>
            <linearGradient id="twin-glow" x1="0" x2="1">
              <stop offset="0" stopColor="#22d3ee" />
              <stop offset="1" stopColor="#a78bfa" />
            </linearGradient>
          </defs>
          {/* site plane */}
          <path
            d="M200 200 L370 115 L200 30 L30 115 Z"
            fill="rgba(34,211,238,0.05)"
            stroke="#22d3ee"
            strokeOpacity="0.5"
          />
          {Array.from({ length: 9 }, (_, i) => {
            const t = (i + 1) / 10;
            return (
              <g key={i} stroke="#22d3ee" strokeOpacity="0.14">
                <line x1={30 + 170 * t} y1={115 + 85 * t} x2={200 + 170 * t} y2={30 + 85 * t} />
                <line x1={30 + 170 * t} y1={115 - 85 * t} x2={200 + 170 * t} y2={200 - 85 * t} />
              </g>
            );
          })}
          {/* house prism */}
          <g
            stroke="url(#twin-glow)"
            strokeWidth="1.6"
            fill="none"
            className="cc-draw"
            pathLength={400}
          >
            <path d="M150 140 L230 180 L290 150 L210 110 Z" fill="rgba(34,211,238,0.06)" />
            <path d="M150 140 L150 95 L230 135 L230 180" />
            <path d="M290 150 L290 105 L230 135" />
            <path d="M150 95 L180 62 L260 102 L290 105" />
            <path d="M180 62 L210 70 L290 105" strokeOpacity="0.6" />
            <path d="M230 135 L260 102" />
          </g>
          {/* curb line */}
          <path d="M60 128 L200 198" stroke="#fbbf24" strokeWidth="2" strokeDasharray="6 4" />
          {/* scan ring */}
          <ellipse
            cx="220"
            cy="140"
            rx="110"
            ry="55"
            fill="none"
            stroke="#22d3ee"
            strokeOpacity="0.35"
          >
            <animate attributeName="rx" values="60;130;60" dur="6s" repeatCount="indefinite" />
            <animate attributeName="ry" values="30;65;30" dur="6s" repeatCount="indefinite" />
            <animate
              attributeName="stroke-opacity"
              values="0.5;0;0.5"
              dur="6s"
              repeatCount="indefinite"
            />
          </ellipse>
          <text x="300" y="60" fill="#67e8f9" fontFamily="ui-monospace, monospace" fontSize="9">
            ROOF
          </text>
          <line x1="298" y1="62" x2="262" y2="96" stroke="#67e8f9" strokeOpacity="0.6" />
          <text x="40" y="160" fill="#fbbf24" fontFamily="ui-monospace, monospace" fontSize="9">
            CURB
          </text>
          <line x1="62" y1="152" x2="100" y2="148" stroke="#fbbf24" strokeOpacity="0.6" />
        </svg>
        <div className="cc-blueprint__scan" aria-hidden="true" />
      </div>
      <div className="cc-stack" style={{ gap: 10 }}>
        <div className="cc-eyebrow">Workspace</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{orgName ?? 'Your company'}</div>
        <p className="web-muted" style={{ margin: 0 }}>
          Roof, curb and full-house estimating in one geospatial command center. Pick a workspace to
          start measuring; every number shown comes from your inputs or your company&apos;s records.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="cc-btn cc-btn--primary" href="/build">
            Build a house estimate
          </a>
          <a className="cc-btn" href="/roof">
            Measure a roof
          </a>
          <a className="cc-btn" href="/curb">
            Price a curb cut
          </a>
        </div>
      </div>
    </div>
  );
}

function QueueList({ data }: { data: Dashboard | null }) {
  const byKey = new Map(data?.queues.map((q) => [q.key, q]) ?? []);
  return (
    <>
      {!data && (
        <p className="web-muted">
          Work queues appear here as {BRAND.products.roof}, {BRAND.products.curb} and the job
          workflow go live. No counts are shown until real records exist.
        </p>
      )}
      <ul className="web-queues">
        {QUEUE_ORDER.map((key) => {
          const queue = byKey.get(key);
          return (
            <li key={key} className={URGENT.has(key) ? 'web-queue web-queue--urgent' : 'web-queue'}>
              <div className="web-queue__head">
                <h3>{queue?.label ?? QUEUE_LABELS[key]}</h3>
                {queue ? (
                  <span className="web-queue__count" aria-label={`${queue.count} items`}>
                    {queue.count}
                  </span>
                ) : (
                  <span className="web-muted web-small">No data yet</span>
                )}
              </div>
              {queue && queue.items.length > 0 && (
                <ul className="web-queue__items">
                  {queue.items.map((item) => (
                    <li key={item.subjectId}>
                      <a href={item.href}>{item.title}</a>{' '}
                      {/* The status text is the blocking reason (PLT-016 B). */}
                      <StatusPill status={item.status} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
              {queue && queue.count === 0 && (
                <p className="web-muted web-small">Nothing waiting.</p>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}
