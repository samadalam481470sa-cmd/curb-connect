'use client';

import {
  BRAND,
  type DASHBOARD_QUEUES,
  getRoute,
  type DashboardResponseSchema,
  type RouteId,
} from '@fieldline/contracts';
import { CurbIcon, RoofIcon, StatusPill } from '@fieldline/ui';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { z } from 'zod';
import { ErrorNotice, PageHeader } from '../../components/common';
import { RouteGate } from '../../components/RouteGate';
import { SearchBox } from '../../components/shell/SearchBox';
import { isApiError } from '../../lib/api';
import { formatDateTime, formatRelative } from '../../lib/format';
import { useDisplay } from '../../lib/display';
import { orgKey, useApi, useSession } from '../../lib/session';

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

  return (
    <>
      <PageHeader
        title="Home"
        description={membership ? `${membership.orgDisplayName}` : undefined}
      />
      <div className="web-phone-only web-block">
        <SearchBox />
      </div>

      <section aria-labelledby="products-heading" className="web-section">
        <h2 id="products-heading">Start work</h2>
        <div className="web-products">
          <ProductCard routeId="roof" icon={<RoofIcon size={28} />} />
          <ProductCard routeId="curb" icon={<CurbIcon size={28} />} />
        </div>
      </section>

      <section aria-labelledby="queues-heading" className="web-section">
        <div className="web-section__head">
          <h2 id="queues-heading">Needs attention</h2>
          {checkedAt > 0 && (
            <p className="web-muted web-small" aria-live="polite">
              {dashboard.data
                ? `Last updated ${formatRelative(dashboard.data.generatedAt, locale)} (${formatDateTime(dashboard.data.generatedAt, locale, timeZone)})`
                : `Last checked ${formatDateTime(new Date(checkedAt).toISOString(), locale, timeZone)}`}
            </p>
          )}
        </div>
        {dashboard.isPending ? (
          <p className="web-muted">Loading queues…</p>
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
    </>
  );
}

function ProductCard({ routeId, icon }: { routeId: RouteId; icon: ReactNode }) {
  const session = useSession();
  const route = getRoute(routeId);
  const permission = session.check(route.permission);
  const flagOn = !route.featureFlag || session.flag(route.featureFlag);
  const blurb =
    routeId === 'roof'
      ? 'Address-based roof sketching, pitch, quantities and measurement reports.'
      : 'Guided job-site photos, reference calibration and preliminary estimate ranges.';
  const unavailable = !permission.allowed
    ? permission.reason
    : !flagOn
      ? 'Not enabled for your company yet.'
      : null;
  return (
    <article className="web-product" aria-labelledby={`product-${routeId}`}>
      <span className="web-product__icon" aria-hidden="true">
        {icon}
      </span>
      <h3 id={`product-${routeId}`}>{route.label}</h3>
      <p className="web-muted">{blurb}</p>
      {unavailable ? (
        <p className="web-denied-reason">{unavailable}</p>
      ) : (
        <a className="fl-btn fl-btn--primary fl-btn--md" href={route.path}>
          <span className="fl-btn__label">Open {route.label}</span>
        </a>
      )}
    </article>
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
