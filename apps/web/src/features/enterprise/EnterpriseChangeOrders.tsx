'use client';

import { getRoute } from '@fieldline/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { errorHint } from '../../lib/api';
import { orgKey, useApi, useSession } from '../../lib/session';
import { changeOrderLabels, ChangeOrderPipeline } from './ChangeOrderPipeline';
import { EnterpriseModuleNav } from './EnterpriseModuleNav';
import { ChangeOrderDetail, ChangeOrderQueue, SuiteStatus } from './schemas';
import { isCoStatus, type ChangeOrder, type COStatus } from './types';

const queuePath = getRoute('enterprise.changeOrders').path;
const apiPath = '/v1/enterprise/change-orders';
const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

function label(status: string) {
  return isCoStatus(status) ? changeOrderLabels[status] : status.replaceAll('_', ' ');
}

function useChangeOrderAccess() {
  const { api } = useApi();
  const session = useSession();
  const key = orgKey(session.orgId, 'enterprise');
  const status = useQuery({
    queryKey: [...key, 'status'],
    queryFn: () => api.get('/v1/enterprise/status', { schema: SuiteStatus }),
    enabled: session.can('job:read'),
  });
  return { api, session, key, status };
}

function ChangeOrderLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="enterprise-suite">
      <header className="enterprise-hero">
        <Link className="enterprise-back" href="/enterprise">
          Enterprise
        </Link>
        <h1>{title}</h1>
      </header>
      <EnterpriseModuleNav area="change-orders" />
      {children}
    </main>
  );
}

function ChangeOrderAccess({
  access,
  children,
}: {
  access: ReturnType<typeof useChangeOrderAccess>;
  children: ReactNode;
}) {
  if (!access.session.can('job:read')) {
    return (
      <p role="alert" className="enterprise-error">
        You do not have permission to view change orders.
      </p>
    );
  }
  if (access.status.isPending) return <p role="status">Checking Enterprise access…</p>;
  if (access.status.isError)
    return (
      <p role="alert" className="enterprise-error">
        {errorHint(access.status.error)}
      </p>
    );
  if (!access.status.data.enabled) {
    return (
      <section className="enterprise-panel">
        <h2>Enable the Enterprise Suite</h2>
        <p>Change orders become available when an owner or administrator enables the suite.</p>
        <Link className="enterprise-back" href="/enterprise">
          Open Enterprise settings
        </Link>
      </section>
    );
  }
  return children;
}

interface QueueProps {
  projectId?: string;
  cursor?: string | string[];
  status?: string | string[];
  search?: string | string[];
}

export function EnterpriseChangeOrderQueue({ cursor, status, search, projectId }: QueueProps) {
  const access = useChangeOrderAccess();
  const searchText = typeof search === 'string' ? search.trim().slice(0, 255) : '';
  const statusValue = typeof status === 'string' && isCoStatus(status) ? status : '';
  const filters = new URLSearchParams();
  if (searchText) filters.set('search', searchText);
  if (statusValue) filters.set('status', statusValue);
  const path = projectId
    ? '/enterprise/projects/' + encodeURIComponent(projectId) + '/change-orders'
    : queuePath;
  const query = new URLSearchParams(filters);
  if (projectId) query.set('projectId', projectId);
  if (typeof cursor === 'string') query.set('cursor', cursor);
  const queue = useQuery({
    queryKey: [...access.key, 'change-orders', query.toString()],
    queryFn: () => access.api.get(apiPath + '?' + query.toString(), { schema: ChangeOrderQueue }),
    enabled: access.status.data?.enabled === true && access.session.can('job:read'),
  });

  function pageHref(nextCursor?: string) {
    const params = new URLSearchParams(filters);
    if (nextCursor) params.set('cursor', nextCursor);
    return params.size ? path + '?' + params.toString() : path;
  }

  return (
    <ChangeOrderLayout title={projectId ? 'Project change orders' : 'Change order queue'}>
      <ChangeOrderAccess access={access}>
        <section className="enterprise-panel">
          <form className="enterprise-form" action={path} method="get">
            <label>
              Search by number, title or project
              <input name="search" type="search" defaultValue={searchText} maxLength={255} />
            </label>
            <label>
              Status
              <select name="status" defaultValue={statusValue}>
                <option value="">All statuses</option>
                {Object.entries(changeOrderLabels).map(([value, name]) => (
                  <option key={value} value={value}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit">Apply filters</button>
          </form>
          {projectId && (
            <Link className="enterprise-back" href={queuePath}>
              All company change orders
            </Link>
          )}
          {access.session.can('job:write') && (
            <p>
              <Link className="enterprise-back" href="/enterprise/controls">
                Create a change order in Project Controls
              </Link>
            </p>
          )}
        </section>
        <section className="enterprise-panel">
          <h2>Change orders</h2>
          {queue.isPending && <p role="status">Loading change orders…</p>}
          {queue.isError && (
            <p role="alert" className="enterprise-error">
              {errorHint(queue.error)}
            </p>
          )}
          {queue.data?.items.length === 0 && (
            <p className="enterprise-empty">No change orders match the selected filters.</p>
          )}
          {!!queue.data?.items.length && (
            <ul className="enterprise-change-queue">
              {queue.data.items.map(({ order, projectName }) => (
                <li key={order.id}>
                  <Link href={'/enterprise/change-orders/' + order.id}>
                    <strong>
                      {order.number} · {order.title}
                    </strong>
                    <span>{projectName}</span>
                  </Link>
                  <span>{label(order.status)}</span>
                  <span>{money.format(order.amountDeltaMinor / 100)}</span>
                  <span>
                    {order.scheduleImpactDays > 0 ? '+' : ''}
                    {order.scheduleImpactDays} days
                  </span>
                </li>
              ))}
            </ul>
          )}
          <nav className="enterprise-actions" aria-label="Change order results">
            {cursor && (
              <Link className="enterprise-back" href={pageHref()}>
                First page
              </Link>
            )}
            {queue.data?.nextCursor && (
              <Link className="enterprise-back" href={pageHref(queue.data.nextCursor)}>
                Next page
              </Link>
            )}
          </nav>
        </section>
      </ChangeOrderAccess>
    </ChangeOrderLayout>
  );
}

export function EnterpriseChangeOrderDetail({ id }: { id: string }) {
  const access = useChangeOrderAccess();
  const queryClient = useQueryClient();
  const path = apiPath + '/' + encodeURIComponent(id);
  const detail = useQuery({
    queryKey: [...access.key, 'change-order', id],
    queryFn: () => access.api.get(path, { schema: ChangeOrderDetail }),
    enabled: access.status.data?.enabled === true && access.session.can('job:read'),
  });

  async function update(order: ChangeOrder, status: COStatus) {
    await access.api.patch(path + '/status', { status }, { ifMatch: order.revision });
    await queryClient.invalidateQueries({ queryKey: access.key });
  }

  const data = detail.data;
  const order = data?.order;
  return (
    <ChangeOrderLayout title={order ? 'Change order ' + order.number : 'Change order'}>
      <ChangeOrderAccess access={access}>
        {detail.isPending && <p role="status">Loading change order…</p>}
        {detail.isError && (
          <p role="alert" className="enterprise-error">
            {errorHint(detail.error)}
          </p>
        )}
        {data && order && (
          <>
            <p>
              <Link
                className="enterprise-back"
                href={'/enterprise/projects/' + order.projectId + '/change-orders'}
              >
                {data.projectName} change orders
              </Link>
              {' · Revision ' + order.revision}
            </p>
            {isCoStatus(order.status) ? (
              <ChangeOrderPipeline
                detail
                changeOrders={[{ ...order, status: order.status }]}
                busy={detail.isFetching}
                canEdit={access.session.can('job:write')}
                canApprove={access.session.can('org:settings_update')}
                onUpdateStatus={update}
              />
            ) : (
              <section className="enterprise-panel">
                <h2>{order.title}</h2>
                <p>{order.description}</p>
                <p>Status: {label(order.status)}</p>
              </section>
            )}
            <section className="enterprise-panel">
              <h2>Decision history</h2>
              {!data.history.length && (
                <p className="enterprise-empty">No audit history is available.</p>
              )}
              <ol className="enterprise-change-history">
                {data.history.map((event) => (
                  <li key={event.id}>
                    <strong>
                      {event.previousStatus && event.status
                        ? label(event.previousStatus) + ' → ' + label(event.status)
                        : event.action === 'pco.created'
                          ? 'Draft created'
                          : event.action}
                    </strong>
                    <span>
                      <time dateTime={event.createdAt}>
                        {new Date(event.createdAt).toLocaleString()}
                      </time>
                      {event.revision && ' · Revision ' + event.revision}
                      {' · ' +
                        (event.actorUserId === access.session.me.user.id
                          ? 'You'
                          : 'Member ' + event.actorUserId)}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          </>
        )}
      </ChangeOrderAccess>
    </ChangeOrderLayout>
  );
}
