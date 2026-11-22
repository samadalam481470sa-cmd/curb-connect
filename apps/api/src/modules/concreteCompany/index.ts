// Concrete Company API: tenant-scoped fleet, drivers, dispatch, telemetry, quality, maintenance and integrations.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { and, count, desc, eq, gt, gte, isNull, notInArray } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  concreteAlerts, concreteCompanySettings, concreteDeliveries, concreteDeviceKeys,
  concreteDrivers, concreteIntegrations, concreteMaintenanceWorkOrders, concretePlants,
  concreteQualityObservations, concreteTelemetryEvents, concreteVehicles,
} from '../../db/schema/concreteCompany';
import { platformTx, requireOrg, tenantTx } from '../../http/context';
import { withTenant, type Tx } from '../../db/runtime';
import { problem } from '../../http/problem';

const UUID = z.uuid();
const VehicleParams = z.object({ vehicleId: UUID });
const DeliveryParams = z.object({ deliveryId: UUID });
const IntegrationParams = z.object({ integrationId: UUID });
const ResourceParams = z.object({ id: UUID });
const Provider = z.enum(['samsara','geotab','command_alkon','jonel','bcmi','giatec','custom_gateway']);
const DeliveryStatus = z.enum(['scheduled','batched','loaded','dispatched','arrived','pouring','completed','cancelled']);
const Yardage = z.number().finite().positive().max(1000);
const Page = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
const SettingsInput = z.object({
  enabled: z.boolean().default(true),
  companyName: z.string().trim().min(2).max(180),
  timezone: z.string().trim().min(1).max(80).default('America/Chicago'),
});
const PlantInput = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(2).max(180),
  address: z.string().trim().max(300).default(''),
  city: z.string().trim().max(100).default(''),
  region: z.string().trim().max(80).default(''),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});
const DriverInput = z.object({
  employeeCode: z.string().trim().min(1).max(40),
  displayName: z.string().trim().min(2).max(180),
  phone: z.string().trim().max(40).optional(),
  email: z.email().optional(),
  externalDriverId: z.string().trim().max(160).optional(),
});
const VehicleInput = z.object({
  vehicleNumber: z.string().trim().min(1).max(40),
  plantId: UUID.nullable().optional(),
  vin: z.string().trim().max(40).optional(),
  make: z.string().trim().max(100).optional(),
  model: z.string().trim().max(100).optional(),
  modelYear: z.number().int().min(1950).max(2100).optional(),
  licensePlate: z.string().trim().max(30).optional(),
});
const AssignDriverInput = z.object({ driverId: UUID.nullable() });
const DeliveryInput = z.object({
  plantId: UUID,
  vehicleId: UUID.nullable().optional(),
  driverId: UUID.nullable().optional(),
  ticketNumber: z.string().trim().min(1).max(80),
  customerName: z.string().trim().max(180).default(''),
  jobName: z.string().trim().min(2).max(180),
  jobAddress: z.string().trim().max(300).default(''),
  jobLatitude: z.number().min(-90).max(90).optional(),
  jobLongitude: z.number().min(-180).max(180).optional(),
  mixCode: z.string().trim().max(80).default(''),
  orderedYards: Yardage,
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
});
const DeliveryStatusInput = z.object({ status: DeliveryStatus, deliveredYards: Yardage.optional() });
const QualityInput = z.object({
  observationType: z.enum(['slump','concrete_temperature','air_content','unit_weight','cylinder_break_7d','cylinder_break_28d','water_added','visual']),
  measuredValue: z.number().finite().min(-100000).max(100000),
  unit: z.string().trim().min(1).max(30),
  result: z.enum(['recorded','pass','warning','fail']).default('recorded'),
  notes: z.string().trim().max(1000).default(''),
  observedAt: z.iso.datetime({ offset: true }).optional(),
});
const MaintenanceInput = z.object({
  workOrderNumber: z.string().trim().min(1).max(80),
  category: z.enum(['engine','transmission','hydraulic','drum','tires','brakes','electrical','sensor','other']),
  priority: z.enum(['low','normal','high','urgent']).default('normal'),
  description: z.string().trim().min(3).max(2000),
  dueAt: z.iso.datetime({ offset: true }).optional(),
});
const MaintenanceStatusInput = z.object({ status: z.enum(['open','in_progress','completed','cancelled']) });
const IntegrationInput = z.object({ provider: Provider, label: z.string().trim().min(2).max(120) });
const CredentialInput = z.object({ apiToken: z.string().trim().min(12).max(4096) });
const GatewayEvent = z.object({
  eventId: z.string().trim().min(1).max(180),
  occurredAt: z.iso.datetime({ offset: true }),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  heading: z.number().min(0).max(360).optional(),
  speedMph: z.number().min(0).max(150).optional(),
  engineRpm: z.number().int().min(0).max(10000).optional(),
  engineHours: z.number().min(0).max(1000000).optional(),
  odometerMiles: z.number().min(0).max(10000000).optional(),
  fuelPercent: z.number().min(0).max(100).optional(),
  engineState: z.enum(['On','Off','Idle']).optional(),
  engineFaultCodes: z.array(z.string().trim().max(80)).max(30).optional(),
  drumRpm: z.number().int().min(0).max(100).optional(),
  drumDirection: z.enum(['mixing','agitating','discharging','stopped','unknown']).optional(),
  waterAddedGallons: z.number().min(0).max(1000).optional(),
  concreteTempF: z.number().min(-50).max(250).optional(),
}).strict();
const GatewayInput = z.object({ events: z.array(GatewayEvent).min(1).max(50) });

const PROVIDERS = [
  { id:'samsara', name:'Samsara', category:'Fleet telematics', capabilities:['GPS location','engine diagnostics','fuel','fault codes','vehicle stats'], auth:'Bearer API token', docs:'https://developers.samsara.com/docs/telematics', state:'supported' },
  { id:'geotab', name:'Geotab MyGeotab', category:'Fleet telematics', capabilities:['GPS','trips','engine measurements','faults','maintenance'], auth:'MyGeotab account / SDK credentials', docs:'https://developers.geotab.com/myGeotab/introduction/', state:'vendor_adapter_required' },
  { id:'command_alkon', name:'Command Alkon Digital Fleet / TrackIt', category:'Ready-mix fleet', capabilities:['truck location','drum rotation','water added','engine data','delivery status'], auth:'Vendor-issued API access', docs:'https://commandalkon.com/products/digital-fleet/', state:'vendor_access_required' },
  { id:'jonel', name:'Jonel Access / FLEX API', category:'Dispatch and batching', capabilities:['orders','dispatch','batching','tickets','fleet tracking'], auth:'Vendor-issued FLEX API access', docs:'https://www.jonel.com/concrete-technology/flex-api', state:'vendor_access_required' },
  { id:'bcmi', name:'BCMI API Portal', category:'Concrete operations', capabilities:['logistics','CRM','materials','operational data'], auth:'BCMI-issued API access', docs:'https://www.bcmicorp.com/introducing-the-bcmi-api-portal-for-seamless-integration-with-concrete-producers-software/', state:'vendor_access_required' },
  { id:'giatec', name:'Giatec SmartMix / MixPilot', category:'Concrete quality', capabilities:['mix optimization','in-transit workability','QC data','pour monitoring'], auth:'Giatec-issued API / partner access', docs:'https://www.giatecscientific.com/products/software/smartmix/', state:'vendor_access_required' },
  { id:'custom_gateway', name:'Curb Connect Truck Gateway', category:'Truck hardware', capabilities:['GPS','J1939 / CAN diagnostics','drum sensors','water meter','temperature'], auth:'Per-truck device key', docs:'', state:'native_gateway' },
] as const;

const DELIVERY_NEXT: Record<string, readonly string[]> = {
  scheduled:['batched','cancelled'], batched:['loaded','cancelled'], loaded:['dispatched','cancelled'],
  dispatched:['arrived','cancelled'], arrived:['pouring','completed','cancelled'],
  pouring:['completed','cancelled'], completed:[], cancelled:[],
};

async function requireEnabled(tx: Tx, orgId: string) {
  const [settings] = await tx.select().from(concreteCompanySettings).where(eq(concreteCompanySettings.orgId, orgId)).limit(1);
  if (!settings?.enabled) throw problem('forbidden', 'Activate Concrete Company for this workspace before using operations.');
}

function integrationKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.from('curb-connect'), Buffer.from('concrete-company-integrations-v1'), 32));
}
function encryptCredential(secret: string, token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', integrationKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
function decryptCredential(secret: string, row: { credentialCiphertext: string | null; credentialIv: string | null; credentialTag: string | null }) {
  if (!row.credentialCiphertext || !row.credentialIv || !row.credentialTag) throw problem('validation_failed', 'Save the provider API token before testing this connection.');
  const decipher = createDecipheriv('aes-256-gcm', integrationKey(secret), Buffer.from(row.credentialIv, 'base64'));
  decipher.setAuthTag(Buffer.from(row.credentialTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(row.credentialCiphertext, 'base64')), decipher.final()]).toString('utf8');
}
async function samsaraJson(token: string, path: string): Promise<Record<string, unknown>> {
  const response = await fetch('https://api.samsara.com' + path, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Samsara API returned HTTP ' + response.status);
  return await response.json() as Record<string, unknown>;
}
async function samsaraPages(token: string, path: string): Promise<Array<Record<string, unknown>>> {
  const items: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  for (let page = 0; page < 30; page += 1) {
    const separator = path.includes('?') ? '&' : '?';
    const response = await samsaraJson(token, path + separator + 'limit=512' + (cursor ? '&after=' + encodeURIComponent(cursor) : ''));
    if (Array.isArray(response.data)) items.push(...response.data as Array<Record<string, unknown>>);
    const pagination = response.pagination as { hasNextPage?: boolean; endCursor?: string } | undefined;
    if (!pagination?.hasNextPage || !pagination.endCursor) break;
    cursor = pagination.endCursor;
  }
  return items;
}
function latest<T extends { time?: string; value?: unknown }>(items: unknown): T | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[items.length - 1] as T;
}

const concreteCompanyModule: FastifyPluginAsyncZod = async (app) => {
  app.get('/concrete-company/overview', {
    config: { permission: 'org:read' },
    schema: { tags: ['concrete-company'], summary: 'Concrete Company fleet and operations overview' },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      const [settings] = await tx.select().from(concreteCompanySettings).where(eq(concreteCompanySettings.orgId, org.orgId)).limit(1);
      const [vehicles] = await tx.select({ value: count() }).from(concreteVehicles).where(eq(concreteVehicles.orgId, org.orgId));
      const [activeVehicles] = await tx.select({ value: count() }).from(concreteVehicles).where(and(eq(concreteVehicles.orgId, org.orgId), eq(concreteVehicles.status, 'active')));
      const [movingVehicles] = await tx.select({ value: count() }).from(concreteVehicles).where(and(eq(concreteVehicles.orgId, org.orgId), eq(concreteVehicles.status, 'active'), gt(concreteVehicles.lastSpeedMph, '2')));
      const [drivers] = await tx.select({ value: count() }).from(concreteDrivers).where(and(eq(concreteDrivers.orgId, org.orgId), eq(concreteDrivers.status, 'active')));
      const [deliveries] = await tx.select({ value: count() }).from(concreteDeliveries).where(and(eq(concreteDeliveries.orgId, org.orgId), notInArray(concreteDeliveries.status, ['completed','cancelled'])));
      const [alerts] = await tx.select({ value: count() }).from(concreteAlerts).where(and(eq(concreteAlerts.orgId, org.orgId), eq(concreteAlerts.status, 'open')));
      const [integrations] = await tx.select({ value: count() }).from(concreteIntegrations).where(and(eq(concreteIntegrations.orgId, org.orgId), eq(concreteIntegrations.status, 'connected')));
      return {
        settings: settings ?? null,
        canManage: org.permissions.has('org:settings_update'),
        stats: {
          vehicles: vehicles?.value ?? 0, activeVehicles: activeVehicles?.value ?? 0,
          movingVehicles: movingVehicles?.value ?? 0, activeDrivers: drivers?.value ?? 0,
          activeDeliveries: deliveries?.value ?? 0, openAlerts: alerts?.value ?? 0,
          connectedIntegrations: integrations?.value ?? 0,
        },
      };
    });
  });

  app.put('/concrete-company/settings', {
    config: { permission: 'org:settings_update', rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], body: SettingsInput, summary: 'Activate or update the company concrete workspace' },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      const [row] = await tx.insert(concreteCompanySettings).values({
        orgId: org.orgId, enabled: request.body.enabled, companyName: request.body.companyName,
        timezone: request.body.timezone, updatedByUserId: org.userId,
      }).onConflictDoUpdate({
        target: concreteCompanySettings.orgId,
        set: { enabled: request.body.enabled, companyName: request.body.companyName, timezone: request.body.timezone,
          updatedByUserId: org.userId, updatedAt: new Date() },
      }).returning();
      return row;
    });
  });

  app.get('/concrete-company/providers', {
    config: { permission: 'org:read' },
    schema: { tags: ['concrete-company'], summary: 'Supported concrete and fleet integration catalog' },
  }, async () => ({ items: PROVIDERS }));

  app.get('/concrete-company/plants', {
    config: { permission: 'job:read' },
    schema: { tags: ['concrete-company'] },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      const items = await tx.select().from(concretePlants).where(eq(concretePlants.orgId, org.orgId)).orderBy(desc(concretePlants.updatedAt)).limit(200);
      return { items };
    });
  });
  app.post('/concrete-company/plants', {
    config: { permission: 'job:write', rateLimit: { max: 30, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], body: PlantInput },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const [row] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.insert(concretePlants).values({ ...request.body, orgId: org.orgId }).returning();
    });
    return reply.code(201).send(row);
  });

  app.get('/concrete-company/drivers', {
    config: { permission: 'job:read' },
    schema: { tags: ['concrete-company'], querystring: Page },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      const [total] = await tx.select({ value: count() }).from(concreteDrivers).where(eq(concreteDrivers.orgId, org.orgId));
      const items = await tx.select().from(concreteDrivers).where(eq(concreteDrivers.orgId, org.orgId))
        .orderBy(desc(concreteDrivers.updatedAt)).limit(request.query.limit).offset(request.query.offset);
      return { items, total: total?.value ?? 0, limit: request.query.limit, offset: request.query.offset };
    });
  });
  app.post('/concrete-company/drivers', {
    config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], body: DriverInput },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const [row] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.insert(concreteDrivers).values({ ...request.body, orgId: org.orgId }).returning();
    });
    return reply.code(201).send(row);
  });

  app.get('/concrete-company/vehicles', {
    config: { permission: 'job:read' },
    schema: { tags: ['concrete-company'], querystring: Page },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      const [total] = await tx.select({ value: count() }).from(concreteVehicles).where(eq(concreteVehicles.orgId, org.orgId));
      const items = await tx.select().from(concreteVehicles).where(eq(concreteVehicles.orgId, org.orgId))
        .orderBy(desc(concreteVehicles.lastSeenAt), desc(concreteVehicles.updatedAt))
        .limit(request.query.limit).offset(request.query.offset);
      return { items, total: total?.value ?? 0, limit: request.query.limit, offset: request.query.offset };
    });
  });
  app.post('/concrete-company/vehicles', {
    config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], body: VehicleInput },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const [row] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.insert(concreteVehicles).values({ ...request.body, orgId: org.orgId }).returning();
    });
    return reply.code(201).send(row);
  });
  app.patch('/concrete-company/vehicles/:vehicleId/driver', {
    config: { permission: 'job:write' },
    schema: { tags: ['concrete-company'], params: VehicleParams, body: AssignDriverInput },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      const [current] = await tx.select({ id: concreteVehicles.id, revision: concreteVehicles.revision }).from(concreteVehicles).where(and(
        eq(concreteVehicles.orgId, org.orgId), eq(concreteVehicles.id, request.params.vehicleId),
      )).limit(1);
      if (!current) throw problem('not_found');
      const [row] = await tx.update(concreteVehicles).set({ currentDriverId: request.body.driverId, revision: current.revision + 1, updatedAt: new Date() })
        .where(and(eq(concreteVehicles.orgId, org.orgId), eq(concreteVehicles.id, request.params.vehicleId))).returning();
      return row;
    });
  });

  app.get('/concrete-company/deliveries', {
    config: { permission: 'job:read' },
    schema: { tags: ['concrete-company'], querystring: Page },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      const items = await tx.select().from(concreteDeliveries).where(eq(concreteDeliveries.orgId, org.orgId))
        .orderBy(desc(concreteDeliveries.scheduledAt), desc(concreteDeliveries.createdAt))
        .limit(request.query.limit).offset(request.query.offset);
      return { items, limit: request.query.limit, offset: request.query.offset };
    });
  });
  app.post('/concrete-company/deliveries', {
    config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], body: DeliveryInput },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const [row] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.insert(concreteDeliveries).values({
        ...request.body, orgId: org.orgId, createdByUserId: org.userId,
        orderedYards: request.body.orderedYards.toFixed(2),
        scheduledAt: request.body.scheduledAt ? new Date(request.body.scheduledAt) : null,
      }).returning();
    });
    return reply.code(201).send(row);
  });
  app.patch('/concrete-company/deliveries/:deliveryId/status', {
    config: { permission: 'job:write' },
    schema: { tags: ['concrete-company'], params: DeliveryParams, body: DeliveryStatusInput },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      const [current] = await tx.select().from(concreteDeliveries).where(and(
        eq(concreteDeliveries.orgId, org.orgId), eq(concreteDeliveries.id, request.params.deliveryId),
      )).limit(1);
      if (!current) throw problem('not_found');
      if (!DELIVERY_NEXT[current.status]?.includes(request.body.status)) throw problem('conflict', 'That delivery status transition is not allowed.');
      const now = new Date();
      const set: Partial<typeof concreteDeliveries.$inferInsert> = {
        status: request.body.status, revision: current.revision + 1, updatedAt: now,
      };
      if (request.body.status === 'loaded') set.loadedAt = now;
      if (request.body.status === 'dispatched') set.departedAt = now;
      if (request.body.status === 'arrived') set.arrivedAt = now;
      if (request.body.status === 'pouring') set.pourStartedAt = now;
      if (request.body.status === 'completed') {
        set.pourCompletedAt = now;
        if (request.body.deliveredYards !== undefined) set.deliveredYards = request.body.deliveredYards.toFixed(2);
      }
      const [updated] = await tx.update(concreteDeliveries).set(set)
        .where(and(eq(concreteDeliveries.orgId, org.orgId), eq(concreteDeliveries.id, current.id))).returning();
      return updated;
    });
  });

  app.get('/concrete-company/quality', {
    config: { permission: 'job:read' },
    schema: { tags: ['concrete-company'], querystring: Page },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      const items = await tx.select().from(concreteQualityObservations)
        .where(eq(concreteQualityObservations.orgId, org.orgId))
        .orderBy(desc(concreteQualityObservations.observedAt))
        .limit(request.query.limit).offset(request.query.offset);
      return { items, limit: request.query.limit, offset: request.query.offset };
    });
  });

  app.post('/concrete-company/deliveries/:deliveryId/quality', {
    config: { permission: 'job:write', rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], params: DeliveryParams, body: QualityInput },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const [row] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.insert(concreteQualityObservations).values({
        orgId: org.orgId, deliveryId: request.params.deliveryId,
        ...request.body, measuredValue: request.body.measuredValue.toFixed(3),
        observedAt: request.body.observedAt ? new Date(request.body.observedAt) : new Date(),
        recordedByUserId: org.userId,
      }).returning();
    });
    return reply.code(201).send(row);
  });

  app.get('/concrete-company/alerts', {
    config: { permission: 'job:read' },
    schema: { tags: ['concrete-company'], querystring: Page },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      const items = await tx.select().from(concreteAlerts).where(eq(concreteAlerts.orgId, org.orgId))
        .orderBy(desc(concreteAlerts.detectedAt)).limit(request.query.limit).offset(request.query.offset);
      return { items };
    });
  });
  app.post('/concrete-company/alerts/:id/acknowledge', {
    config: { permission: 'job:write' },
    schema: { tags: ['concrete-company'], params: ResourceParams },
  }, async (request) => {
    const org = requireOrg(request);
    const [row] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.update(concreteAlerts).set({
        status: 'acknowledged', acknowledgedAt: new Date(), acknowledgedByUserId: org.userId,
      }).where(and(eq(concreteAlerts.orgId, org.orgId), eq(concreteAlerts.id, request.params.id), eq(concreteAlerts.status, 'open'))).returning();
    });
    if (!row) throw problem('not_found');
    return row;
  });

  app.get('/concrete-company/maintenance', {
    config: { permission: 'job:read' },
    schema: { tags: ['concrete-company'], querystring: Page },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      const items = await tx.select().from(concreteMaintenanceWorkOrders).where(eq(concreteMaintenanceWorkOrders.orgId, org.orgId))
        .orderBy(desc(concreteMaintenanceWorkOrders.createdAt)).limit(request.query.limit).offset(request.query.offset);
      return { items };
    });
  });
  app.post('/concrete-company/vehicles/:vehicleId/maintenance', {
    config: { permission: 'job:write', rateLimit: { max: 40, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], params: VehicleParams, body: MaintenanceInput },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const [row] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.insert(concreteMaintenanceWorkOrders).values({
        ...request.body, orgId: org.orgId, vehicleId: request.params.vehicleId,
        dueAt: request.body.dueAt ? new Date(request.body.dueAt) : null,
        createdByUserId: org.userId,
      }).returning();
    });
    return reply.code(201).send(row);
  });
  app.patch('/concrete-company/maintenance/:id/status', {
    config: { permission: 'job:write' },
    schema: { tags: ['concrete-company'], params: ResourceParams, body: MaintenanceStatusInput },
  }, async (request) => {
    const org = requireOrg(request);
    const [row] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.update(concreteMaintenanceWorkOrders).set({
        status: request.body.status,
        completedAt: request.body.status === 'completed' ? new Date() : null,
        updatedAt: new Date(),
      }).where(and(eq(concreteMaintenanceWorkOrders.orgId, org.orgId), eq(concreteMaintenanceWorkOrders.id, request.params.id))).returning();
    });
    if (!row) throw problem('not_found');
    return row;
  });

  app.get('/concrete-company/integrations', {
    config: { permission: 'org:read' },
    schema: { tags: ['concrete-company'] },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      const rows = await tx.select().from(concreteIntegrations).where(eq(concreteIntegrations.orgId, org.orgId)).orderBy(desc(concreteIntegrations.updatedAt));
      return { items: rows.map(({ credentialCiphertext, credentialIv, credentialTag, ...safe }) => safe) };
    });
  });
  app.post('/concrete-company/integrations', {
    config: { permission: 'integration:manage', rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], body: IntegrationInput },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const [row] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      const provider = PROVIDERS.find((item) => item.id === request.body.provider)!;
      return tx.insert(concreteIntegrations).values({
        orgId: org.orgId, provider: request.body.provider, label: request.body.label,
        status: provider.id === 'samsara' ? 'credentials_required' : provider.id === 'custom_gateway' ? 'native_gateway' : 'vendor_access_required',
        createdByUserId: org.userId,
      }).onConflictDoUpdate({
        target: [concreteIntegrations.orgId, concreteIntegrations.provider],
        set: { label: request.body.label, updatedAt: new Date() },
      }).returning();
    });
    return reply.code(201).send(row ? (({ credentialCiphertext, credentialIv, credentialTag, ...safe }) => safe)(row) : null);
  });
  app.put('/concrete-company/integrations/:integrationId/credentials', {
    config: { permission: 'integration:manage', rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], params: IntegrationParams, body: CredentialInput },
  }, async (request) => {
    const org = requireOrg(request);
    const encrypted = encryptCredential(request.server.config.session.secret, request.body.apiToken);
    const [row] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.update(concreteIntegrations).set({
        credentialCiphertext: encrypted.ciphertext, credentialIv: encrypted.iv, credentialTag: encrypted.tag,
        status: 'ready_to_test', lastError: null, updatedAt: new Date(),
      }).where(and(eq(concreteIntegrations.orgId, org.orgId), eq(concreteIntegrations.id, request.params.integrationId))).returning();
    });
    if (!row) throw problem('not_found');
    return { id: row.id, provider: row.provider, status: row.status };
  });
  app.post('/concrete-company/integrations/:integrationId/test', {
    config: { permission: 'integration:manage', rateLimit: { max: 10, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], params: IntegrationParams },
  }, async (request) => {
    const org = requireOrg(request);
    const [integration] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.select().from(concreteIntegrations).where(and(
        eq(concreteIntegrations.orgId, org.orgId), eq(concreteIntegrations.id, request.params.integrationId),
      )).limit(1);
    });
    if (!integration) throw problem('not_found');
    if (integration.provider !== 'samsara') {
      return { status: integration.status, tested: false, message: 'This provider requires vendor-issued API access and its approved adapter. The connection is registered but is not represented as live until that access is configured.' };
    }
    try {
      const token = decryptCredential(request.server.config.session.secret, integration);
      const data = await samsaraJson(token, '/fleet/vehicles?limit=1');
      const countFound = Array.isArray(data.data) ? data.data.length : 0;
      await tenantTx(request, async (tx) => {
        await tx.update(concreteIntegrations).set({ status: 'connected', lastError: null, updatedAt: new Date() })
          .where(and(eq(concreteIntegrations.orgId, org.orgId), eq(concreteIntegrations.id, integration.id)));
      });
      return { status: 'connected', tested: true, sampleVehicles: countFound, message: 'Samsara credentials were accepted. Run Sync to import vehicle records and telemetry.' };
    } catch {
      await tenantTx(request, async (tx) => {
        await tx.update(concreteIntegrations).set({ status: 'connection_error', lastError: 'Credential test failed. Verify token, API permissions and network access.', updatedAt: new Date() })
          .where(and(eq(concreteIntegrations.orgId, org.orgId), eq(concreteIntegrations.id, integration.id)));
      });
      throw problem('dependency_unavailable', 'Samsara connection test failed. Verify the API token and required vehicle read permissions.');
    }
  });

  app.post('/concrete-company/integrations/:integrationId/sync', {
    config: { permission: 'integration:manage', rateLimit: { max: 4, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], params: IntegrationParams },
  }, async (request) => {
    const org = requireOrg(request);
    const [integration] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.select().from(concreteIntegrations).where(and(
        eq(concreteIntegrations.orgId, org.orgId), eq(concreteIntegrations.id, request.params.integrationId),
      )).limit(1);
    });
    if (!integration) throw problem('not_found');
    if (integration.provider !== 'samsara' || integration.status !== 'connected') {
      throw problem('validation_failed', 'Only a successfully tested Samsara connection can be synced by this release.');
    }
    const token = decryptCredential(request.server.config.session.secret, integration);
    const externalVehicles = await samsaraPages(token, '/fleet/vehicles');
    const stats = await samsaraPages(token, '/fleet/vehicles/stats?types=gps,engineStates,engineRpm');
    const diagnostics = await samsaraPages(token, '/fleet/vehicles/stats?types=fuelPercents,faultCodes,engineCoolantTemperatureMilliC');
    const byId = new Map(stats.map((item) => [String(item.id), item]));
    const diagnosticsById = new Map(diagnostics.map((item) => [String(item.id), item]));
    let imported = 0;
    await tenantTx(request, async (tx) => {
      for (const external of externalVehicles) {
        if (!external.id) continue;
        const externalId = String(external.id);
        const vehicleNumber = String(external.name || ('SAMSARA-' + externalId)).slice(0, 40);
        const [vehicle] = await tx.insert(concreteVehicles).values({
          orgId: org.orgId, vehicleNumber, telematicsProvider: 'samsara', externalVehicleId: externalId,
          licensePlate: typeof external.licensePlate === 'string' ? external.licensePlate.slice(0, 30) : null,
          vin: typeof external.vin === 'string' ? external.vin.slice(0, 40) : null,
        }).onConflictDoUpdate({
          target: [concreteVehicles.orgId, concreteVehicles.telematicsProvider, concreteVehicles.externalVehicleId],
          set: {
            vehicleNumber, licensePlate: typeof external.licensePlate === 'string' ? external.licensePlate.slice(0, 30) : null,
            vin: typeof external.vin === 'string' ? external.vin.slice(0, 40) : null, updatedAt: new Date(),
          },
        }).returning();
        if (!vehicle) continue;
        imported += 1;
        const stat = byId.get(externalId);
        if (!stat) continue;
        const gps = latest<{time?:string;value?:{latitude?:number;longitude?:number;speedMilesPerHour?:number;headingDegrees?:number}}>(stat.gps);
        const engine = latest<{time?:string;value?:string}>(stat.engineStates);
        const rpm = latest<{time?:string;value?:number}>(stat.engineRpm);
        const diagnostic = diagnosticsById.get(externalId);
        const fuel = latest<{time?:string;value?:number}>(diagnostic?.fuelPercents);
        const faults = latest<{time?:string;value?:unknown}>(diagnostic?.faultCodes);
        const patch: Partial<typeof concreteVehicles.$inferInsert> = { updatedAt: new Date() };
        if (gps?.value?.latitude !== undefined) patch.lastLatitude = gps.value.latitude;
        if (gps?.value?.longitude !== undefined) patch.lastLongitude = gps.value.longitude;
        if (gps?.value?.speedMilesPerHour !== undefined) patch.lastSpeedMph = String(gps.value.speedMilesPerHour);
        if (gps?.value?.headingDegrees !== undefined) patch.lastHeading = gps.value.headingDegrees;
        if (gps?.time) patch.lastSeenAt = new Date(gps.time);
        if (rpm?.value !== undefined) patch.engineRpm = rpm.value;
        if (engine?.value !== undefined) patch.engineState = engine.value;
        if (fuel?.value !== undefined) patch.fuelPercent = String(fuel.value);
        if (faults?.value !== undefined) patch.engineFaultCodes = Array.isArray(faults.value) ? faults.value : (faults.value ? [faults.value] : []);
        await tx.update(concreteVehicles).set(patch).where(and(
          eq(concreteVehicles.orgId, org.orgId), eq(concreteVehicles.id, vehicle.id),
        ));
      }
      await tx.update(concreteIntegrations).set({ lastSyncAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(and(eq(concreteIntegrations.orgId, org.orgId), eq(concreteIntegrations.id, integration.id)));
    });
    return { importedVehicles: imported, telemetryVehicles: stats.length, diagnosticVehicles: diagnostics.length, note: 'This adapter imports paginated vehicle inventory plus GPS, engine state, RPM, fuel and fault-code snapshots. Continuous feed synchronization and additional provider adapters are separate follow-up work.' };
  });

  app.get('/concrete-company/insights', {
    config: { permission: 'analytics:read' },
    schema: { tags: ['concrete-company'], summary: 'Rule-based operations insights from recorded company data' },
  }, async (request) => {
    const org = requireOrg(request);
    return tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      const now = new Date();
      const cutoff = new Date(now.getTime() - 15 * 60 * 1000);
      const vehicles = await tx.select().from(concreteVehicles).where(and(eq(concreteVehicles.orgId, org.orgId), eq(concreteVehicles.status, 'active'))).limit(2000);
      const deliveries = await tx.select().from(concreteDeliveries).where(and(eq(concreteDeliveries.orgId, org.orgId), notInArray(concreteDeliveries.status, ['completed','cancelled']))).limit(1000);
      const maintenance = await tx.select().from(concreteMaintenanceWorkOrders).where(and(eq(concreteMaintenanceWorkOrders.orgId, org.orgId), notInArray(concreteMaintenanceWorkOrders.status, ['completed','cancelled']))).limit(1000);
      const insights: Array<{id:string;severity:string;title:string;message:string;action:string;vehicleId?:string;deliveryId?:string}> = [];
      for (const vehicle of vehicles) {
        if (vehicle.lastSeenAt && vehicle.lastSeenAt < cutoff) insights.push({
          id:'stale-' + vehicle.id, severity:'medium', title:'Truck telemetry is stale',
          message:vehicle.vehicleNumber + ' has not reported in more than 15 minutes.',
          action:'Check gateway power, cellular coverage and provider synchronization.', vehicleId:vehicle.id,
        });
        if (vehicle.fuelPercent !== null && Number(vehicle.fuelPercent) <= 15) insights.push({
          id:'fuel-' + vehicle.id, severity:'medium', title:'Low fuel level',
          message:vehicle.vehicleNumber + ' reports ' + vehicle.fuelPercent + '% fuel remaining.',
          action:'Review the next route and schedule refueling.', vehicleId:vehicle.id,
        });
        if (Array.isArray(vehicle.engineFaultCodes) && vehicle.engineFaultCodes.length > 0) insights.push({
          id:'fault-' + vehicle.id, severity:'high', title:'Engine fault codes reported',
          message:vehicle.vehicleNumber + ' has ' + vehicle.engineFaultCodes.length + ' active diagnostic code(s).',
          action:'Have maintenance review the diagnostic codes before the next dispatch.', vehicleId:vehicle.id,
        });
      }
      for (const delivery of deliveries) {
        if (delivery.scheduledAt && delivery.scheduledAt < now) insights.push({
          id:'late-' + delivery.id, severity:'high', title:'Delivery is past its scheduled time',
          message:'Ticket ' + delivery.ticketNumber + ' for ' + delivery.jobName + ' is still ' + delivery.status + '.',
          action:'Contact dispatch and update the delivery status or customer ETA.', deliveryId:delivery.id,
        });
      }
      for (const order of maintenance) {
        if (order.dueAt && order.dueAt < now) insights.push({
          id:'maintenance-' + order.id, severity:'medium', title:'Maintenance work order is overdue',
          message:order.workOrderNumber + ' is due and remains ' + order.status + '.',
          action:'Assign a technician and update the work order.', vehicleId:order.vehicleId,
        });
      }
      return { generatedAt: now.toISOString(), method: 'transparent_rules_v1', insights: insights.slice(0, 200),
        disclaimer: 'These are operational rules, not trained predictive models. Predictive maintenance and concrete workability models require validated historical sensor and QC data.' };
    });
  });

  app.post('/concrete-company/vehicles/:vehicleId/device-keys', {
    config: { permission: 'integration:manage', rateLimit: { max: 20, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], params: VehicleParams, body: z.object({ label: z.string().trim().min(2).max(120) }) },
  }, async (request, reply) => {
    const org = requireOrg(request);
    const token = 'ccg_live_' + randomBytes(32).toString('base64url');
    const prefix = token.slice(0, 20);
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const [key] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.insert(concreteDeviceKeys).values({
        orgId: org.orgId, vehicleId: request.params.vehicleId, label: request.body.label,
        keyPrefix: prefix, tokenHash, createdByUserId: org.userId,
      }).returning({ id: concreteDeviceKeys.id, keyPrefix: concreteDeviceKeys.keyPrefix });
    });
    if (!key) throw new Error('Device key creation failed.');
    return reply.code(201).send({
      ...key, token, endpoint: '/v1/concrete-company/gateway/telemetry',
      warning: 'Copy this token now. It is shown only once; Curb Connect stores only its SHA-256 hash.',
    });
  });

  app.post('/concrete-company/device-keys/:id/revoke', {
    config: { permission: 'integration:manage' },
    schema: { tags: ['concrete-company'], params: ResourceParams },
  }, async (request) => {
    const org = requireOrg(request);
    const [row] = await tenantTx(request, async (tx) => {
      await requireEnabled(tx, org.orgId);
      return tx.update(concreteDeviceKeys).set({ status: 'revoked', revokedAt: new Date() })
        .where(and(eq(concreteDeviceKeys.orgId, org.orgId), eq(concreteDeviceKeys.id, request.params.id), eq(concreteDeviceKeys.status, 'active')))
        .returning({ id: concreteDeviceKeys.id, status: concreteDeviceKeys.status });
    });
    if (!row) throw problem('not_found');
    return row;
  });

  // Public machine-to-machine endpoint. The per-truck key identifies one tenant and one vehicle.
  // It never accepts an org id or vehicle id from the caller, preventing cross-tenant spoofing.
  app.post('/concrete-company/gateway/telemetry', {
    config: { auth: 'none', rateLimit: { max: 300, timeWindow: '1 minute' } },
    schema: { tags: ['concrete-company'], body: GatewayInput, summary: 'Ingest signed per-truck gateway telemetry' },
  }, async (request, reply) => {
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token.startsWith('ccg_live_')) throw problem('unauthenticated');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const key = await platformTx(request, 'concrete.gateway_ingest', async (tx) => {
      const [row] = await tx.select().from(concreteDeviceKeys).where(and(
        eq(concreteDeviceKeys.keyPrefix, token.slice(0, 20)), eq(concreteDeviceKeys.tokenHash, tokenHash),
        eq(concreteDeviceKeys.status, 'active'), isNull(concreteDeviceKeys.revokedAt),
      )).limit(1);
      if (row) await tx.update(concreteDeviceKeys).set({ lastUsedAt: new Date() }).where(eq(concreteDeviceKeys.id, row.id));
      return row ?? null;
    });
    if (!key) throw problem('unauthenticated');
    const result = await withTenant(request.server.db, { orgId: key.orgId, userId: null }, async (tx) => {
      let accepted = 0;
      for (const event of request.body.events) {
        const [inserted] = await tx.insert(concreteTelemetryEvents).values({
          orgId: key.orgId, vehicleId: key.vehicleId, provider: 'custom_gateway',
          externalEventId: event.eventId, eventType: 'vehicle_telemetry',
          occurredAt: new Date(event.occurredAt), payload: event,
        }).onConflictDoNothing().returning({ id: concreteTelemetryEvents.id });
        if (!inserted) continue;
        accepted += 1;
        const patch: Partial<typeof concreteVehicles.$inferInsert> = {
          lastSeenAt: new Date(event.occurredAt), updatedAt: new Date(),
        };
        if (event.latitude !== undefined) patch.lastLatitude = event.latitude;
        if (event.longitude !== undefined) patch.lastLongitude = event.longitude;
        if (event.heading !== undefined) patch.lastHeading = event.heading;
        if (event.speedMph !== undefined) patch.lastSpeedMph = event.speedMph.toFixed(2);
        if (event.engineState !== undefined) patch.engineState = event.engineState;
        if (event.engineRpm !== undefined) patch.engineRpm = event.engineRpm;
        if (event.engineHours !== undefined) patch.engineHours = event.engineHours.toFixed(2);
        if (event.odometerMiles !== undefined) patch.odometerMiles = event.odometerMiles.toFixed(2);
        if (event.fuelPercent !== undefined) patch.fuelPercent = event.fuelPercent.toFixed(2);
        if (event.engineFaultCodes !== undefined) patch.engineFaultCodes = event.engineFaultCodes;
        if (event.drumRpm !== undefined) patch.drumRpm = event.drumRpm;
        if (event.drumDirection !== undefined) patch.drumDirection = event.drumDirection;
        if (event.waterAddedGallons !== undefined) patch.waterAddedGallons = event.waterAddedGallons.toFixed(2);
        if (event.concreteTempF !== undefined) patch.concreteTempF = event.concreteTempF.toFixed(2);
        await tx.update(concreteVehicles).set(patch).where(and(
          eq(concreteVehicles.orgId, key.orgId), eq(concreteVehicles.id, key.vehicleId),
        ));
        if (event.engineFaultCodes?.length) {
          const recentCutoff = new Date(Date.now() - 30 * 60 * 1000);
          const [existingAlert] = await tx.select({ id: concreteAlerts.id }).from(concreteAlerts).where(and(
            eq(concreteAlerts.orgId, key.orgId), eq(concreteAlerts.vehicleId, key.vehicleId),
            eq(concreteAlerts.alertType, 'engine_fault'), eq(concreteAlerts.status, 'open'),
            gte(concreteAlerts.detectedAt, recentCutoff),
          )).limit(1);
          if (!existingAlert) {
            await tx.insert(concreteAlerts).values({
              orgId: key.orgId, vehicleId: key.vehicleId, alertType: 'engine_fault',
              severity: 'high', title: 'Truck diagnostic fault reported',
              message: 'The truck gateway reported one or more engine diagnostic fault codes.',
              details: { codes: event.engineFaultCodes, eventId: event.eventId },
            });
          }
        }
      }
      return { accepted, received: request.body.events.length };
    });
    return reply.code(202).send(result);
  });
};

export default concreteCompanyModule;
