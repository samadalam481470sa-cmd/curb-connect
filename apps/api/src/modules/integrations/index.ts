// `integrations` module (builder operations section, items 11–12): QuickBooks Online sync
// and the B2B payments rail — both gated scaffolding, following the voice front desk
// pattern. Neither is connected today: QuickBooks needs the owner's Intuit OAuth app
// (QUICKBOOKS_CLIENT_ID / QUICKBOOKS_CLIENT_SECRET), and moving money needs a regulated
// payments provider (PAYMENTS_PROVIDER + its credentials) plus compliance decisions only
// the owner can make. The status endpoints name exactly what is missing; the action
// endpoints answer with the honest gated state and never pretend a sync ran or money moved.
// CSV/TSV import already exists elsewhere and stays the way in until QuickBooks connects.
import {
  PaymentsRailStatusSchema,
  PayoutRequestSchema,
  PayoutResultSchema,
  QuickBooksStatusSchema,
  QuickBooksSyncResultSchema,
} from '@fieldline/contracts';
import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { apInvoices, integrationSyncLog, lienReleases } from '../../db/schema';
import { requireOrg, tenantTx } from '../../http/context';
import { problem } from '../../http/problem';
import { auditRequest } from '../../services/audit';

const MANAGE = 'integration:manage';
const PAYOUT_READ = 'payout:read';
const PAYOUT_MANAGE = 'payout:manage';

export const QUICKBOOKS_ENV_VARS = ['QUICKBOOKS_CLIENT_ID', 'QUICKBOOKS_CLIENT_SECRET'] as const;
export const PAYMENTS_SUPPORTED_PROVIDERS = ['stripe_connect', 'dwolla'] as const;
export const PAYMENTS_ENV_VARS: Record<string, string[]> = {
  stripe_connect: ['STRIPE_CONNECT_SECRET_KEY'],
  dwolla: ['DWOLLA_KEY', 'DWOLLA_SECRET'],
};

export function quickBooksStatus(env: NodeJS.ProcessEnv) {
  const missing = QUICKBOOKS_ENV_VARS.filter((v) => !env[v]?.trim());
  if (missing.length) {
    return {
      state: 'not_connected' as const,
      missing: [...missing],
      message:
        'QuickBooks Online is not connected. Set the Intuit OAuth app credentials on the API service, then connect your QuickBooks company. Until then, use the CSV/TSV import that already exists — nothing syncs.',
    };
  }
  return {
    state: 'misconfigured' as const,
    missing: [] as string[],
    message:
      'Intuit app credentials are set, but no QuickBooks company has completed the sign-in flow yet, so sync stays off. Nothing syncs until a company connects its QuickBooks.',
  };
}

export function paymentsRailStatus(env: NodeJS.ProcessEnv) {
  const provider = env.PAYMENTS_PROVIDER?.trim() || null;
  const lienWaiverGating = env.PAYMENTS_LIEN_WAIVER_GATING === 'true';
  const earlyPayEnabled = env.PAYMENTS_EARLY_PAY_ENABLED === 'true';
  if (!provider) {
    return {
      provider: null,
      state: 'not_connected' as const,
      missing: ['PAYMENTS_PROVIDER'],
      message:
        'No payments provider is connected, so no money moves. Choose a regulated provider (Stripe Connect or Dwolla) and set PAYMENTS_PROVIDER plus its credentials. AP invoices can still be approved and payment recorded by hand.',
      lienWaiverGating,
      earlyPayEnabled,
    };
  }
  if (!(PAYMENTS_SUPPORTED_PROVIDERS as readonly string[]).includes(provider)) {
    return {
      provider,
      state: 'unsupported_provider' as const,
      missing: [] as string[],
      message: `Payments provider "${provider}" is not supported. Supported: ${PAYMENTS_SUPPORTED_PROVIDERS.join(', ')}. No money moves.`,
      lienWaiverGating,
      earlyPayEnabled,
    };
  }
  const missing = (PAYMENTS_ENV_VARS[provider] ?? []).filter((v) => !env[v]?.trim());
  if (missing.length) {
    return {
      provider,
      state: 'not_connected' as const,
      missing,
      message: `Payments provider ${provider} is chosen but its credentials are missing. Set ${missing.join(', ')} on the API service. No money moves until then.`,
      lienWaiverGating,
      earlyPayEnabled,
    };
  }
  return {
    provider,
    state: 'connected' as const,
    missing: [] as string[],
    message:
      'Payments provider credentials are set. Payouts still require the provider wiring and compliance checks to be finished before money moves — the payout endpoint reports that honestly until then.',
    lienWaiverGating,
    earlyPayEnabled,
  };
}

const integrationsModule: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/integrations/quickbooks/status',
    {
      config: { permission: MANAGE, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['integrations'],
        summary: 'Whether QuickBooks Online sync is connected (and what is missing)',
        response: { 200: QuickBooksStatusSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const status = quickBooksStatus(process.env);
      const last = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(integrationSyncLog)
          .where(
            and(
              eq(integrationSyncLog.orgId, orgId),
              eq(integrationSyncLog.provider, 'quickbooks'),
              eq(integrationSyncLog.state, 'ok'),
            ),
          )
          .orderBy(desc(integrationSyncLog.ranAt))
          .limit(1);
        return row ?? null;
      });
      return { ...status, lastSyncedAt: last?.ranAt.toISOString() ?? null };
    },
  );

  app.post(
    '/integrations/quickbooks/sync',
    {
      config: { permission: MANAGE, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['integrations'],
        summary: 'Run a QuickBooks sync (reports not_connected until the Intuit app is connected)',
        response: { 200: QuickBooksSyncResultSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const status = quickBooksStatus(process.env);
      await tenantTx(request, async (tx) => {
        await tx.insert(integrationSyncLog).values({
          orgId,
          provider: 'quickbooks',
          state: 'not_connected',
          pushed: 0,
          pulled: 0,
          message: status.message,
        });
        await auditRequest(request, tx, {
          orgId,
          action: 'integration.quickbooks_sync_attempted',
          resourceType: 'integration',
          resourceId: orgId,
          after: { state: status.state },
        });
      });
      return {
        state: 'not_connected' as const,
        message: status.message,
        pushed: 0,
        pulled: 0,
      };
    },
  );

  app.get(
    '/integrations/payments-rail/status',
    {
      config: { permission: PAYOUT_READ, rateLimit: { max: 60, timeWindow: '1 minute' } },
      schema: {
        tags: ['integrations'],
        summary: 'Whether a payments provider is connected for payouts (and what is missing)',
        response: { 200: PaymentsRailStatusSchema },
      },
    },
    async (request) => {
      requireOrg(request);
      return paymentsRailStatus(process.env);
    },
  );

  app.post(
    '/integrations/payments-rail/payout',
    {
      config: { permission: PAYOUT_MANAGE, rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        tags: ['integrations'],
        summary: 'Pay an approved AP invoice through the payments rail (gated until a provider is connected)',
        body: PayoutRequestSchema,
        response: { 200: PayoutResultSchema },
      },
    },
    async (request) => {
      const { orgId } = requireOrg(request);
      const status = paymentsRailStatus(process.env);
      if (status.state !== 'connected') {
        return {
          state: 'not_connected' as const,
          message: status.message,
        };
      }
      // Provider credentials exist, but the money-movement wiring + compliance checks are
      // not finished. Check the invoice + lien gating honestly, then report blocked —
      // never queued, because nothing will actually move.
      const invoice = await tenantTx(request, async (tx) => {
        const [row] = await tx
          .select()
          .from(apInvoices)
          .where(and(eq(apInvoices.orgId, orgId), eq(apInvoices.id, request.body.apInvoiceId)))
          .limit(1);
        return row ?? null;
      });
      if (!invoice) throw problem('not_found');
      if (invoice.status !== 'approved') {
        return {
          state: 'blocked' as const,
          message: `This invoice is ${invoice.status.replaceAll('_', ' ')}; only an approved invoice can be paid.`,
        };
      }
      if (status.lienWaiverGating) {
        const waiver = await tenantTx(request, async (tx) => {
          if (!invoice.lienReleaseId) return null;
          const [row] = await tx
            .select({ id: lienReleases.id, status: lienReleases.status })
            .from(lienReleases)
            .where(
              and(eq(lienReleases.orgId, orgId), eq(lienReleases.id, invoice.lienReleaseId)),
            )
            .limit(1);
          return row ?? null;
        });
        if (!waiver || (waiver.status !== 'received' && waiver.status !== 'verified')) {
          return {
            state: 'blocked' as const,
            message:
              'Lien-waiver gating is on and no received/verified lien waiver is on file for this invoice, so the payout is blocked.',
          };
        }
      }
      return {
        state: 'blocked' as const,
        message:
          'The payments provider credentials are set, but the payout wiring and compliance checks are not finished, so no money moved. Record the payment by hand on the AP invoice until the rail is live.',
      };
    },
  );
};

export default integrationsModule;
