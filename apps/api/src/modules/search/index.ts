// `search` module: tenant-scoped global search (PLT-016 A).
//
// Results come from records the caller's company actually owns: every query filters on org_id and
// runs inside the tenant transaction, so Row-Level Security applies as well. There is no
// cross-tenant index, no cached result and no synthesized one. Matches are literal (LIKE wildcards
// in the query are escaped), and each result links to the screen that owns the record today;
// detail screens are not built yet, so a link never points at an unbuilt route.
import {
  SEARCH_RESULT_TYPES,
  SearchQuerySchema,
  SearchResponseSchema,
  type SearchResultSchema,
} from '@fieldline/contracts';
import { and, eq, ilike, isNull, or } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { z } from 'zod';
import {
  contacts,
  curbProjects,
  customers,
  invoices,
  jobs,
  leads,
  properties,
  proposals,
  roofOrders,
} from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';

type SearchResult = z.infer<typeof SearchResultSchema>;

/** Escape LIKE wildcards so a literal `%` or `_` in the query is matched, not interpreted. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (match) => `\\${match}`);

const searchModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/search',
    {
      config: { permission: 'search:read', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['search'],
        summary:
          'Search customers, contacts, leads, jobs, addresses, roof and curb projects, proposals and invoices in this company',
        querystring: SearchQuerySchema,
        response: { 200: SearchResponseSchema },
      },
    },
    async (request) => {
      const org = requireOrg(request);
      const query = request.query.q;
      const limit = request.query.limit;
      const pattern = `%${escapeLike(query)}%`;
      const wanted = new Set<string>(
        request.query.types && request.query.types.length > 0
          ? request.query.types
          : SEARCH_RESULT_TYPES,
      );
      // Invoice numbers and statuses are financial data (PLT-015): roles without invoice:read get
      // no invoice matches rather than a redacted teaser.
      if (!org.permissions.has('invoice:read')) wanted.delete('invoice');

      const results = await tenantTx(request, async (tx) => {
        const found: SearchResult[] = [];

        if (wanted.has('customer')) {
          const rows = await tx
            .select({
              id: customers.id,
              title: customers.displayName,
              companyName: customers.companyName,
            })
            .from(customers)
            .where(
              and(
                eq(customers.orgId, org.orgId),
                isNull(customers.deletedAt),
                or(ilike(customers.displayName, pattern), ilike(customers.companyName, pattern)),
              ),
            )
            .limit(limit);
          found.push(
            ...rows.map((row) => ({
              type: 'customer' as const,
              id: row.id,
              title: row.title,
              subtitle: row.companyName && row.companyName !== row.title ? row.companyName : null,
              href: '/leads',
            })),
          );
        }

        if (wanted.has('contact')) {
          const rows = await tx
            .select({
              id: contacts.id,
              title: contacts.displayName,
              email: contacts.email,
              phone: contacts.phone,
            })
            .from(contacts)
            .where(
              and(
                eq(contacts.orgId, org.orgId),
                isNull(contacts.deletedAt),
                or(
                  ilike(contacts.displayName, pattern),
                  ilike(contacts.email, pattern),
                  ilike(contacts.phone, pattern),
                ),
              ),
            )
            .limit(limit);
          found.push(
            ...rows.map((row) => ({
              type: 'contact' as const,
              id: row.id,
              title: row.title,
              subtitle: row.email ?? row.phone ?? null,
              href: '/leads',
            })),
          );
        }

        if (wanted.has('lead')) {
          const rows = await tx
            .select({ id: leads.id, summary: leads.summary, status: leads.status })
            .from(leads)
            .where(
              and(
                eq(leads.orgId, org.orgId),
                isNull(leads.deletedAt),
                ilike(leads.summary, pattern),
              ),
            )
            .limit(limit);
          found.push(
            ...rows.map((row) => ({
              type: 'lead' as const,
              id: row.id,
              title: row.summary ?? `Lead ${row.id.slice(0, 8).toUpperCase()}`,
              subtitle: row.status,
              href: '/leads',
            })),
          );
        }

        if (wanted.has('job')) {
          const rows = await tx
            .select({
              id: jobs.id,
              number: jobs.number,
              title: jobs.title,
              status: jobs.status,
            })
            .from(jobs)
            .where(
              and(
                eq(jobs.orgId, org.orgId),
                isNull(jobs.deletedAt),
                or(ilike(jobs.number, pattern), ilike(jobs.title, pattern)),
              ),
            )
            .limit(limit);
          found.push(
            ...rows.map((row) => ({
              type: 'job' as const,
              id: row.id,
              title: `${row.number} · ${row.title}`,
              subtitle: row.status,
              href: '/jobs',
            })),
          );
        }

        if (wanted.has('property')) {
          const rows = await tx
            .select({
              id: properties.id,
              originalQuery: properties.originalQuery,
              normalizedAddress: properties.normalizedAddress,
              locality: properties.locality,
              region: properties.region,
            })
            .from(properties)
            .where(
              and(
                eq(properties.orgId, org.orgId),
                isNull(properties.deletedAt),
                or(
                  ilike(properties.originalQuery, pattern),
                  ilike(properties.normalizedAddress, pattern),
                  ilike(properties.line1, pattern),
                  ilike(properties.locality, pattern),
                  ilike(properties.postalCode, pattern),
                ),
              ),
            )
            .limit(limit);
          found.push(
            ...rows.map((row) => {
              const place = [row.locality, row.region].filter(Boolean).join(', ');
              return {
                type: 'property' as const,
                id: row.id,
                title: row.normalizedAddress ?? row.originalQuery,
                subtitle: place.length > 0 ? place : null,
                href: '/roof',
              };
            }),
          );
        }

        if (wanted.has('roof_order')) {
          const rows = await tx
            .select({ id: roofOrders.id, number: roofOrders.number, status: roofOrders.status })
            .from(roofOrders)
            .where(and(eq(roofOrders.orgId, org.orgId), ilike(roofOrders.number, pattern)))
            .limit(limit);
          found.push(
            ...rows.map((row) => ({
              type: 'roof_order' as const,
              id: row.id,
              title: `Roof order ${row.number}`,
              subtitle: row.status,
              href: '/roof',
            })),
          );
        }

        if (wanted.has('curb_project')) {
          const rows = await tx
            .select({
              id: curbProjects.id,
              number: curbProjects.number,
              status: curbProjects.status,
              description: curbProjects.description,
            })
            .from(curbProjects)
            .where(
              and(
                eq(curbProjects.orgId, org.orgId),
                or(ilike(curbProjects.number, pattern), ilike(curbProjects.description, pattern)),
              ),
            )
            .limit(limit);
          found.push(
            ...rows.map((row) => ({
              type: 'curb_project' as const,
              id: row.id,
              title: `Curb project ${row.number}`,
              subtitle: row.status,
              href: '/curb',
            })),
          );
        }

        if (wanted.has('proposal')) {
          const rows = await tx
            .select({
              id: proposals.id,
              number: proposals.number,
              title: proposals.title,
              status: proposals.status,
            })
            .from(proposals)
            .where(
              and(
                eq(proposals.orgId, org.orgId),
                or(ilike(proposals.number, pattern), ilike(proposals.title, pattern)),
              ),
            )
            .limit(limit);
          found.push(
            ...rows.map((row) => ({
              type: 'proposal' as const,
              id: row.id,
              title: `${row.number} · ${row.title}`,
              subtitle: row.status,
              href: '/proposals',
            })),
          );
        }

        if (wanted.has('invoice')) {
          const rows = await tx
            .select({ id: invoices.id, number: invoices.number, status: invoices.status })
            .from(invoices)
            .where(and(eq(invoices.orgId, org.orgId), ilike(invoices.number, pattern)))
            .limit(limit);
          found.push(
            ...rows.map((row) => ({
              type: 'invoice' as const,
              id: row.id,
              title: `Invoice ${row.number}`,
              subtitle: row.status,
              href: '/invoice-dashboard',
            })),
          );
        }

        // Records whose name starts with the query come first; ties fall back to the type order the
        // contract declares and then the title, so the list is stable between identical searches.
        const lower = query.toLowerCase();
        const typeOrder = new Map<string, number>(
          SEARCH_RESULT_TYPES.map((type, index) => [type, index]),
        );
        const rank = (result: SearchResult) =>
          result.title.toLowerCase().startsWith(lower) ? 0 : 1;
        found.sort(
          (a, b) =>
            rank(a) - rank(b) ||
            a.title.localeCompare(b.title) ||
            (typeOrder.get(a.type) ?? 0) - (typeOrder.get(b.type) ?? 0),
        );
        return found.slice(0, limit);
      });

      return { results };
    },
  );
};

export default searchModule;
