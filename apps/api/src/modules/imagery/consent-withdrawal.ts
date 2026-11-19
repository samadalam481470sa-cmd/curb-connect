// Contractor consent withdrawal. The original grant is never edited: a new consent row with
// status 'withdrawn' supersedes it, and every linked imagery asset is marked expired with an
// expiry of now. The caller writes the audit event in the same transaction, so the grant,
// withdrawal, asset state and audit trail can never disagree.
import { and, desc, eq, sql } from 'drizzle-orm';
import { consents, imageryAssets } from '../../db/schema';
import type { Tx } from '../../db/runtime';
import { problem } from '../../http/problem';

export type ConsentRow = typeof consents.$inferSelect;
export type ImageryAssetRow = typeof imageryAssets.$inferSelect;

export interface WithdrawContractorConsentInput {
  orgId: string;
  consentId: string;
  reason: string;
  actorUserId?: string | null;
}

export interface WithdrawContractorConsentResult {
  /** The withdrawal row (or the existing withdrawal on an idempotent replay). */
  consent: ConsentRow;
  /** The granted consent that was withdrawn. */
  originalConsentId: string;
  assets: ImageryAssetRow[];
  alreadyWithdrawn: boolean;
}

export async function withdrawContractorConsent(
  tx: Tx,
  input: WithdrawContractorConsentInput,
): Promise<WithdrawContractorConsentResult> {
  const [original] = await tx
    .select()
    .from(consents)
    .where(and(eq(consents.orgId, input.orgId), eq(consents.id, input.consentId)))
    .for('update')
    .limit(1);

  if (!original) throw problem('not_found', 'No such consent.');
  if (original.supersedesId !== null) {
    throw problem('validation_failed', 'This consent record is already a withdrawal.');
  }
  if (original.kind !== 'imagery_analysis') {
    throw problem('validation_failed', 'Only imagery analysis consent can be withdrawn here.');
  }

  const [existing] = await tx
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.orgId, input.orgId),
        eq(consents.supersedesId, original.id),
        eq(consents.status, 'withdrawn'),
      ),
    )
    .orderBy(desc(consents.recordedAt))
    .limit(1);

  if (existing) {
    const assets = await tx
      .select()
      .from(imageryAssets)
      .where(and(eq(imageryAssets.orgId, input.orgId), eq(imageryAssets.consentId, original.id)));
    return {
      consent: existing,
      originalConsentId: original.id,
      assets,
      alreadyWithdrawn: true,
    };
  }

  if (original.status !== 'granted') {
    throw problem('invalid_transition', 'Only a granted consent can be withdrawn.');
  }

  const withdrawnAt = new Date();
  const [withdrawal] = await tx
    .insert(consents)
    .values({
      orgId: input.orgId,
      kind: original.kind,
      status: 'withdrawn',
      supersedesId: original.id,
      source: 'contractor_consent_withdrawal',
      policyVersion: original.policyVersion,
      recordedAt: withdrawnAt,
      evidence: {
        reason: input.reason,
        originalConsentId: original.id,
        originalSource: original.source,
        withdrawnAt: withdrawnAt.toISOString(),
        ...(input.actorUserId ? { withdrawnByUserId: input.actorUserId } : {}),
      },
    })
    .returning();

  if (!withdrawal) throw new Error('Consent withdrawal insert returned no row.');

  const assets = await tx
    .update(imageryAssets)
    .set({
      status: 'expired',
      expiresAt: sql`least(coalesce(${imageryAssets.expiresAt}, now()), now())`,
      revision: sql`${imageryAssets.revision} + 1`,
    })
    .where(and(eq(imageryAssets.orgId, input.orgId), eq(imageryAssets.consentId, original.id)))
    .returning();

  return {
    consent: withdrawal,
    originalConsentId: original.id,
    assets,
    alreadyWithdrawn: false,
  };
}
