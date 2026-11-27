import { createHash } from 'node:crypto';
import { ActionSchema, effectivePermissions } from '@fieldline/contracts';
import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../db/runtime';
import { enterpriseSettings } from '../../db/schema/enterprise';
import { enterpriseSalesLeads as leads } from '../../db/schema/enterpriseSalesLeads';
import { salesReportRuns as reports } from '../../db/schema/enterpriseSalesReports';
import { memberships, permissionOverrides } from '../../db/schema/team';
import { csvCell } from '../invoiceIntel';

type Run = typeof reports.$inferSelect;
const contactColumns = ['email', 'phone'] as const;
export function reportHash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function permittedContact(
  lead: Pick<typeof leads.$inferSelect, 'consent' | 'email' | 'phone'>,
  purpose: NonNullable<Run['contactPurpose']>,
  channel: (typeof contactColumns)[number],
) {
  return lead.consent[purpose][channel] === 'granted' ? lead[channel] : null;
}

export async function reportContactFieldsMatch(tx: Tx, run: Run) {
  const { contactPurpose } = run;
  if (!contactPurpose || !run.snapshot.length) return true;
  const rows = await tx
    .select({
      id: leads.id,
      email: leads.email,
      phone: leads.phone,
      consent: leads.consent,
    })
    .from(leads)
    .where(
      and(
        eq(leads.orgId, run.orgId),
        inArray(
          leads.id,
          run.snapshot.map((row) => row.id),
        ),
      ),
    );
  const current = new Map(rows.map((row) => [row.id, row]));
  return run.snapshot.every((row) => {
    const lead = current.get(row.id);
    return (
      lead &&
      contactColumns.every(
        (channel) =>
          !run.columns.includes(channel) ||
          permittedContact(lead, contactPurpose, channel) === row.fields[channel],
      )
    );
  });
}

export async function completeSalesReport(tx: Tx, orgId: string, id: string) {
  const [run] = await tx
    .select()
    .from(reports)
    .where(and(eq(reports.orgId, orgId), eq(reports.id, id), eq(reports.status, 'queued')))
    .for('update');
  if (!run) return;
  const [member] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .innerJoin(
      enterpriseSettings,
      and(eq(enterpriseSettings.orgId, orgId), eq(enterpriseSettings.enabled, true)),
    )
    .where(
      and(
        eq(memberships.orgId, orgId),
        eq(memberships.id, run.requestedByMembershipId),
        eq(memberships.userId, run.requestedByUserId),
        eq(memberships.status, 'active'),
      ),
    );
  const overrides = member
    ? await tx
        .select()
        .from(permissionOverrides)
        .where(
          and(
            eq(permissionOverrides.orgId, orgId),
            eq(permissionOverrides.membershipId, run.requestedByMembershipId),
          ),
        )
    : [];
  const permissions =
    member &&
    effectivePermissions(
      member.role,
      overrides.flatMap((override) => {
        const action = ActionSchema.safeParse(override.action);
        return action.success
          ? [
              {
                action: action.data,
                effect: override.effect,
                expiresAt: override.expiresAt?.toISOString(),
              },
            ]
          : [];
      }),
    );
  const allowed =
    permissions &&
    permissions.has('enterprise_sales:intake') &&
    permissions.has('enterprise_sales:manage') &&
    (!run.contactPurpose ||
      (permissions.has('enterprise_sales:export_contacts') &&
        (await reportContactFieldsMatch(tx, run))));
  const scope = and(eq(reports.orgId, orgId), eq(reports.id, id));
  const completedAt = new Date();
  if (!allowed) {
    await tx.update(reports).set({ status: 'failed', completedAt, snapshot: [] }).where(scope);
    return;
  }
  const fileText =
    run.format === 'csv'
      ? [run.columns, ...run.snapshot.map((row) => run.columns.map((column) => row.fields[column]))]
          .map((row) => row.map(csvCell).join(','))
          .join('\r\n') + '\r\n'
      : JSON.stringify({ columns: run.columns, rows: run.snapshot.map((row) => row.fields) }) +
        '\n';
  await tx
    .update(reports)
    .set({
      status: 'ready',
      completedAt,
      fileText,
      sha256: reportHash(fileText),
      // Only consent-bearing runs need a snapshot for reauthorization at download.
      snapshot: run.contactPurpose ? run.snapshot : [],
    })
    .where(scope);
}
