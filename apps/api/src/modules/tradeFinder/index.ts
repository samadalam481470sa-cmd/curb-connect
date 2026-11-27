// `tradeFinder` module (blueprint gap 6): search opted-in directory
// companies (published data only, via the named platform operation
// 'trade_finder.search') plus the org's own private vendor records. Filters:
// trade, city, ZIP (exact or 3-digit sectional area — labeled approximate),
// availability, qualifications on file (license/insurance expiry status from
// entered dates). "Request connection" stays on the existing
// POST /network/connections flow.
import {
  CreateVendorRequestSchema,
  DirectoryProfileSchema,
  TradeSearchQuerySchema,
  TradeSearchResponseSchema,
  UpdateDirectoryProfileRequestSchema,
  UpdateVendorRequestSchema,
  VendorProfileSchema,
  type TradeSearchResult,
} from '@fieldline/contracts';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  companyConnections,
  directoryProfiles,
  organizations,
  vendorProfiles,
} from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { platformTx, requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';
import { expiryStatus, matchesFilters, type TradeCandidate } from './search';

const VendorParams = z.object({ vendorId: z.uuid() });

type VendorRow = typeof vendorProfiles.$inferSelect;

const todayIso = () => new Date().toISOString().slice(0, 10);

function vendorDto(v: VendorRow) {
  const today = todayIso();
  return {
    id: v.id,
    name: v.name,
    trade: v.trade,
    contactName: v.contactName,
    contactPhone: v.contactPhone,
    contactEmail: v.contactEmail,
    serviceCities: v.serviceCities,
    serviceZips: v.serviceZips,
    availability: v.availability,
    availabilityNote: v.availabilityNote,
    licenseNumber: v.licenseNumber,
    licenseExpiresOn: v.licenseExpiresOn,
    licenseStatus: expiryStatus(v.licenseExpiresOn, today),
    insuranceExpiresOn: v.insuranceExpiresOn,
    insuranceStatus: expiryStatus(v.insuranceExpiresOn, today),
    qualificationsNote: v.qualificationsNote,
    notes: v.notes,
    revision: v.revision,
  };
}

const tradeFinderModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/trade-finder/profile',
    {
      config: { permission: 'network:read' },
      schema: {
        tags: ['trade-finder'],
        summary: 'This company’s published trade-directory profile.',
        response: { 200: DirectoryProfileSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [org] = await tx
          .select({ directoryOptIn: organizations.directoryOptIn })
          .from(organizations)
          .where(eq(organizations.id, orgId));
        const [profile] = await tx
          .select()
          .from(directoryProfiles)
          .where(eq(directoryProfiles.orgId, orgId));
        return {
          trades: profile?.trades ?? [],
          serviceCities: profile?.serviceCities ?? [],
          serviceZips: profile?.serviceZips ?? [],
          availability: profile?.availability ?? null,
          availabilityNote: profile?.availabilityNote ?? null,
          licenseNumber: profile?.licenseNumber ?? null,
          licenseExpiresOn: profile?.licenseExpiresOn ?? null,
          insuranceExpiresOn: profile?.insuranceExpiresOn ?? null,
          qualificationsNote: profile?.qualificationsNote ?? null,
          directoryOptIn: org?.directoryOptIn ?? false,
          revision: profile?.revision ?? 0,
        };
      });
    },
  );

  app.put(
    '/trade-finder/profile',
    {
      config: { permission: 'network:listing_update', rateLimit: { max: 30, timeWindow: '1 minute' } },
      schema: {
        tags: ['trade-finder'],
        body: UpdateDirectoryProfileRequestSchema,
        summary:
          'Update this company’s trade-directory profile. It is only visible to others while the company is opted in to the directory.',
        response: { 200: DirectoryProfileSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const b = request.body;
        const [existing] = await tx
          .select()
          .from(directoryProfiles)
          .where(eq(directoryProfiles.orgId, orgId))
          .for('update');
        const values = {
          orgId,
          trades: b.trades ?? existing?.trades ?? [],
          serviceCities: b.serviceCities ?? existing?.serviceCities ?? [],
          serviceZips: b.serviceZips ?? existing?.serviceZips ?? [],
          availability: b.availability !== undefined ? b.availability : (existing?.availability ?? null),
          availabilityNote: b.availabilityNote !== undefined ? b.availabilityNote : (existing?.availabilityNote ?? null),
          licenseNumber: b.licenseNumber !== undefined ? b.licenseNumber : (existing?.licenseNumber ?? null),
          licenseExpiresOn: b.licenseExpiresOn !== undefined ? b.licenseExpiresOn : (existing?.licenseExpiresOn ?? null),
          insuranceExpiresOn: b.insuranceExpiresOn !== undefined ? b.insuranceExpiresOn : (existing?.insuranceExpiresOn ?? null),
          qualificationsNote: b.qualificationsNote !== undefined ? b.qualificationsNote : (existing?.qualificationsNote ?? null),
        };
        let profile;
        if (existing) {
          const [updated] = await tx
            .update(directoryProfiles)
            .set({ ...values, revision: existing.revision + 1, updatedAt: new Date() })
            .where(eq(directoryProfiles.id, existing.id))
            .returning();
          if (!updated) throw problem('internal');
          profile = updated;
        } else {
          const [inserted] = await tx.insert(directoryProfiles).values(values).returning();
          if (!inserted) throw problem('internal');
          profile = inserted;
        }
        const [org] = await tx
          .select({ directoryOptIn: organizations.directoryOptIn })
          .from(organizations)
          .where(eq(organizations.id, orgId));
        await auditRequest(request, tx, {
          orgId,
          action: 'trade_finder.profile_updated',
          resourceType: 'directory_profile',
          resourceId: profile.id,
          after: { trades: profile.trades },
        });
        return {
          trades: profile.trades,
          serviceCities: profile.serviceCities,
          serviceZips: profile.serviceZips,
          availability: profile.availability,
          availabilityNote: profile.availabilityNote,
          licenseNumber: profile.licenseNumber,
          licenseExpiresOn: profile.licenseExpiresOn,
          insuranceExpiresOn: profile.insuranceExpiresOn,
          qualificationsNote: profile.qualificationsNote,
          directoryOptIn: org?.directoryOptIn ?? false,
          revision: profile.revision,
        };
      });
    },
  );

  app.get(
    '/trade-finder/vendors',
    {
      config: { permission: 'vendor:read' },
      schema: {
        tags: ['trade-finder'],
        summary: 'This company’s private vendor records.',
        response: { 200: z.object({ items: z.array(VendorProfileSchema) }) },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const rows = await tx
          .select()
          .from(vendorProfiles)
          .where(eq(vendorProfiles.orgId, orgId))
          .orderBy(asc(vendorProfiles.name))
          .limit(200);
        return { items: rows.map(vendorDto) };
      });
    },
  );

  app.post(
    '/trade-finder/vendors',
    {
      config: { permission: 'vendor:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['trade-finder'],
        body: CreateVendorRequestSchema,
        summary: 'Add a private vendor record with qualification fields.',
        response: { 201: VendorProfileSchema },
      },
    },
    async (request, reply) => {
      const { orgId } = requireOrg(request);
      const created = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .insert(vendorProfiles)
          .values({
            orgId,
            name: request.body.name,
            trade: request.body.trade ?? null,
            contactName: request.body.contactName ?? null,
            contactPhone: request.body.contactPhone ?? null,
            contactEmail: request.body.contactEmail ?? null,
            serviceCities: request.body.serviceCities,
            serviceZips: request.body.serviceZips,
            availability: request.body.availability ?? null,
            availabilityNote: request.body.availabilityNote ?? null,
            licenseNumber: request.body.licenseNumber ?? null,
            licenseExpiresOn: request.body.licenseExpiresOn ?? null,
            insuranceExpiresOn: request.body.insuranceExpiresOn ?? null,
            qualificationsNote: request.body.qualificationsNote ?? null,
            notes: request.body.notes ?? null,
          })
          .returning();
        if (!row) throw problem('internal');
        return row;
      });
      return reply.code(201).send(vendorDto(created));
    },
  );

  app.patch(
    '/trade-finder/vendors/:vendorId',
    {
      config: { permission: 'vendor:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['trade-finder'],
        params: VendorParams,
        body: UpdateVendorRequestSchema,
        summary: 'Update a private vendor record.',
        response: { 200: VendorProfileSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      return tenantTx(request, async (tx) => {
        const [vendor] = await tx
          .select()
          .from(vendorProfiles)
          .where(and(eq(vendorProfiles.orgId, orgId), eq(vendorProfiles.id, request.params.vendorId)));
        if (!vendor) throw problem('not_found');
        const b = request.body;
        const [updated] = await tx
          .update(vendorProfiles)
          .set({
            ...(b.name !== undefined && { name: b.name }),
            ...(b.trade !== undefined && { trade: b.trade }),
            ...(b.contactName !== undefined && { contactName: b.contactName }),
            ...(b.contactPhone !== undefined && { contactPhone: b.contactPhone }),
            ...(b.contactEmail !== undefined && { contactEmail: b.contactEmail }),
            ...(b.serviceCities !== undefined && { serviceCities: b.serviceCities }),
            ...(b.serviceZips !== undefined && { serviceZips: b.serviceZips }),
            ...(b.availability !== undefined && { availability: b.availability }),
            ...(b.availabilityNote !== undefined && { availabilityNote: b.availabilityNote }),
            ...(b.licenseNumber !== undefined && { licenseNumber: b.licenseNumber }),
            ...(b.licenseExpiresOn !== undefined && { licenseExpiresOn: b.licenseExpiresOn }),
            ...(b.insuranceExpiresOn !== undefined && { insuranceExpiresOn: b.insuranceExpiresOn }),
            ...(b.qualificationsNote !== undefined && { qualificationsNote: b.qualificationsNote }),
            ...(b.notes !== undefined && { notes: b.notes }),
            revision: vendor.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(vendorProfiles.orgId, orgId), eq(vendorProfiles.id, vendor.id)))
          .returning();
        if (!updated) throw problem('internal');
        return vendorDto(updated);
      });
    },
  );

  app.get(
    '/trade-finder/search',
    {
      config: { permission: 'network:read' },
      schema: {
        tags: ['trade-finder'],
        querystring: TradeSearchQuerySchema,
        summary:
          'Search opted-in directory companies (published data only) and this company’s own vendor records by trade, city, ZIP/area, availability, and qualifications.',
        response: { 200: TradeSearchResponseSchema },
      },
    },
    async (request) => {
      const { orgId, userId } = requireOrg(request);
      const q = request.query;
      const today = todayIso();
      const filters = {
        trade: q.trade,
        city: q.city,
        zip: q.zip,
        zipArea: q.zipArea,
        availability: q.availability,
        qualifiedOnly: q.qualifiedOnly,
      };

      // Directory half: cross-tenant read of published fields only.
      const directory = await platformTx(
        request,
        'trade_finder.search',
        async (tx: Tx) => {
          const orgs = await tx
            .select({
              orgId: organizations.id,
              displayName: organizations.displayName,
              serviceAreaLabel: organizations.serviceAreaLabel,
            })
            .from(organizations)
            .where(
              and(
                eq(organizations.directoryOptIn, true),
                eq(organizations.status, 'active'),
                ne(organizations.id, orgId),
              ),
            )
            .orderBy(asc(organizations.displayName))
            .limit(500);
          const ids = orgs.map((o) => o.orgId);
          const profiles = ids.length
            ? await tx
                .select()
                .from(directoryProfiles)
                .where(inArray(directoryProfiles.orgId, ids))
            : [];
          const profileByOrg = new Map(profiles.map((p) => [p.orgId, p]));
          const mine = await tx
            .select({ partnerOrgId: companyConnections.partnerOrgId, status: companyConnections.status })
            .from(companyConnections)
            .where(eq(companyConnections.orgId, orgId));
          const statusByPartner = new Map(mine.map((c) => [c.partnerOrgId, c.status]));
          return orgs.map((o) => ({ org: o, profile: profileByOrg.get(o.orgId) ?? null, connectionStatus: statusByPartner.get(o.orgId) ?? null }));
        },
        { orgId, userId },
      );

      const directoryItems = directory
        .map(({ org, profile, connectionStatus }) => {
          const candidate: TradeCandidate = {
            trades: profile?.trades ?? [],
            serviceCities: profile?.serviceCities ?? [],
            serviceZips: profile?.serviceZips ?? [],
            availability: profile?.availability ?? null,
            licenseStatus: expiryStatus(profile?.licenseExpiresOn ?? null, today),
            insuranceStatus: expiryStatus(profile?.insuranceExpiresOn ?? null, today),
          };
          return {
            source: 'directory' as const,
            id: org.orgId,
            name: org.displayName,
            trades: candidate.trades as string[],
            serviceCities: candidate.serviceCities as string[],
            serviceZips: candidate.serviceZips as string[],
            serviceAreaLabel: org.serviceAreaLabel,
            availability: profile?.availability ?? null,
            availabilityNote: profile?.availabilityNote ?? null,
            licenseNumber: profile?.licenseNumber ?? null,
            licenseExpiresOn: profile?.licenseExpiresOn ?? null,
            licenseStatus: candidate.licenseStatus,
            insuranceExpiresOn: profile?.insuranceExpiresOn ?? null,
            insuranceStatus: candidate.insuranceStatus,
            contactName: null,
            contactPhone: null,
            contactEmail: null,
            connectionStatus,
            candidate,
          };
        })
        .filter((r) => matchesFilters(r.candidate, filters))
        .map(({ candidate: _candidate, ...rest }) => rest);

      // Vendor half: this org's own private records.
      let vendorItems: TradeSearchResult[] = [];
      if (q.includeVendors) {
        const vendors = await tenantTx(request, (tx) =>
          tx
            .select()
            .from(vendorProfiles)
            .where(eq(vendorProfiles.orgId, orgId))
            .orderBy(asc(vendorProfiles.name))
            .limit(500),
        );
        vendorItems = vendors
          .map((v) => {
            const candidate: TradeCandidate = {
              trades: v.trade ? [v.trade] : [],
              serviceCities: v.serviceCities,
              serviceZips: v.serviceZips,
              availability: v.availability,
              licenseStatus: expiryStatus(v.licenseExpiresOn, today),
              insuranceStatus: expiryStatus(v.insuranceExpiresOn, today),
            };
            return {
              source: 'vendor' as const,
              id: v.id,
              name: v.name,
              trades: candidate.trades as string[],
              serviceCities: v.serviceCities,
              serviceZips: v.serviceZips,
              serviceAreaLabel: null,
              availability: v.availability,
              availabilityNote: v.availabilityNote,
              licenseNumber: v.licenseNumber,
              licenseExpiresOn: v.licenseExpiresOn,
              licenseStatus: candidate.licenseStatus,
              insuranceExpiresOn: v.insuranceExpiresOn,
              insuranceStatus: candidate.insuranceStatus,
              contactName: v.contactName,
              contactPhone: v.contactPhone,
              contactEmail: v.contactEmail,
              connectionStatus: null,
              candidate,
            };
          })
          .filter((r) => matchesFilters(r.candidate, filters))
          .map(({ candidate: _candidate, ...rest }) => rest);
      }

      const items = [...directoryItems, ...vendorItems].slice(0, q.limit);
      return { items, directoryCount: directoryItems.length, vendorCount: vendorItems.length };
    },
  );
};

export default tradeFinderModule;
