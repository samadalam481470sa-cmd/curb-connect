import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type {
  HomeownerFinancialFields,
  PreviewHomeownerFinanceVisibility,
} from '@fieldline/contracts';
import type { Tx } from '../../db/runtime';
import { proposals, proposalVersions, proposalSelections } from '../../db/schema/proposals';
import { enterpriseCostForecastSnapshots as forecasts } from '../../db/schema/enterpriseCostForecasts';
import { homeownerFinanceVisibilityRevisions as revisions } from '../../db/schema/enterpriseHomeownerFinance';
import { problem } from '../../http/problem';
import { findActiveHomeownerContact, latestHomeownerRecipient } from './jobsiteHomeownerAccess';

export type FinanceProjectScope = { orgId: string; projectId: string };
type PreviewInput = z.infer<typeof PreviewHomeownerFinanceVisibility>;

export function homeownerFinanceTokenHash(token: string) {
  return createHash('sha256')
    .update('homeowner-finance:' + token)
    .digest('hex');
}
export function newHomeownerFinanceToken() {
  return randomBytes(32).toString('base64url');
}
export function homeownerFinanceUrl(origin: string, projectId: string, token: string) {
  const url = new URL('/portal/homeowner/projects/' + projectId + '/financials', origin);
  url.hash = new URLSearchParams({ t: token }).toString();
  return url.href;
}

export function homeownerFinanceHistory(tx: Tx, scope: FinanceProjectScope, limit: number) {
  return tx
    .select()
    .from(revisions)
    .where(and(eq(revisions.orgId, scope.orgId), eq(revisions.projectId, scope.projectId)))
    .orderBy(desc(revisions.revision))
    .limit(limit);
}

export async function acceptedHomeownerContract(
  tx: Tx,
  scope: FinanceProjectScope,
  source: {
    contactId: string;
    acceptedProposalId: string;
    acceptedProposalVersionId: string;
  },
) {
  const [contract] = await tx
    .select({
      proposalNumber: proposals.number,
      proposalVersion: proposalVersions.versionNumber,
      contractMinor: proposalSelections.totalMinor,
      currency: proposals.currency,
    })
    .from(proposals)
    .innerJoin(
      proposalVersions,
      and(
        eq(proposalVersions.orgId, proposals.orgId),
        eq(proposalVersions.proposalId, proposals.id),
        eq(proposalVersions.id, proposals.acceptedVersionId),
        eq(proposalVersions.status, 'accepted'),
      ),
    )
    .innerJoin(
      proposalSelections,
      and(
        eq(proposalSelections.orgId, proposals.orgId),
        eq(proposalSelections.proposalVersionId, proposalVersions.id),
      ),
    )
    .where(
      and(
        eq(proposals.orgId, scope.orgId),
        eq(proposals.id, source.acceptedProposalId),
        eq(proposals.contactId, source.contactId),
        eq(proposalVersions.id, source.acceptedProposalVersionId),
        eq(proposals.status, 'accepted'),
      ),
    );
  return contract;
}

export async function activeHomeownerFinanceRecipient(tx: Tx, row: typeof revisions.$inferSelect) {
  if (!row.contactId || !row.recipientGrantId) return;
  const [recipient, grant] = await Promise.all([
    findActiveHomeownerContact(tx, row.orgId, row.contactId),
    latestHomeownerRecipient(tx, row, row.contactId),
  ]);
  return grant?.active && grant.id === row.recipientGrantId ? recipient : undefined;
}

export async function prepareHomeownerFinancePreview(
  tx: Tx,
  scope: FinanceProjectScope,
  selection: PreviewInput,
) {
  const recipient = await findActiveHomeownerContact(tx, scope.orgId, selection.contactId);
  const grant = await latestHomeownerRecipient(tx, scope, selection.contactId);
  const contract = await acceptedHomeownerContract(tx, scope, selection);
  if (!recipient || !grant?.active || !contract)
    throw problem('not_found', 'The assigned contact and accepted proposal do not match.');
  const disclosure: z.infer<typeof HomeownerFinancialFields> = {
    contractMinor: contract.contractMinor,
    currency: contract.currency,
  };
  let forecastId: string | null = null;
  if (selection.discloseInternalCost || selection.discloseMargin) {
    const [forecast] = await tx
      .select()
      .from(forecasts)
      .where(
        and(
          eq(forecasts.orgId, scope.orgId),
          eq(forecasts.projectId, scope.projectId),
          eq(forecasts.status, 'complete'),
          eq(forecasts.currency, contract.currency),
        ),
      )
      .orderBy(desc(forecasts.createdAt), desc(forecasts.id))
      .limit(1);
    if (!forecast || (selection.discloseMargin && forecast.marginMinor === null))
      throw problem(
        'conflict',
        'Save a complete forecast in the accepted contract currency before sharing these fields.',
      );
    forecastId = forecast.id;
    if (selection.discloseInternalCost) disclosure.approvedInternalCostMinor = forecast.actualMinor;
    if (selection.discloseMargin && forecast.marginMinor !== null)
      disclosure.approvedMarginMinor = forecast.marginMinor;
  }
  const previewFingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        scope,
        selection,
        grantId: grant.id,
        forecastId,
        disclosure,
      }),
    )
    .digest('hex');
  return {
    recipientName: recipient.displayName,
    proposalNumber: contract.proposalNumber,
    proposalVersion: contract.proposalVersion,
    disclosure,
    previewFingerprint,
    grantId: grant.id,
    forecastId,
  };
}
