import { renderToBuffer } from '@fieldline/pdf';
import type { ApprovedSalesEstimatePricing, SalesProposalTemplate } from '@fieldline/contracts';
import type { z } from 'zod';

type Pricing = z.infer<typeof ApprovedSalesEstimatePricing>;
type Template = z.infer<typeof SalesProposalTemplate>;

export function salesProposalDocument({
  number,
  title,
  buyer,
  company,
  preparedAt,
  expires,
  pricing,
  template,
}: {
  number: string;
  title: string;
  buyer: string;
  company: string;
  preparedAt: Date;
  expires: string;
  pricing: Pricing;
  template: Template;
}) {
  const money = (amountMinor: number) => ({ amountMinor, currency: pricing.currency });
  const packageId = 'approved-scope';
  return renderToBuffer({
    kind: 'proposal',
    meta: {
      documentId: number,
      revision: 1,
      issuedAt: preparedAt.toISOString(),
      timeZone: 'UTC',
      organization: { name: company },
    },
    customer: { name: buyer, addressLines: [] },
    title,
    budgetary: false,
    options: [
      {
        id: packageId,
        name: 'Approved scope',
        scope: pricing.includedScope,
        exclusions: pricing.excludedScope,
        lines: [
          { description: 'Base scope', total: money(pricing.baseSellMinor) },
          ...pricing.options.map(({ name, amountMinor }) => ({
            description: name,
            total: money(amountMinor ?? 0),
          })),
          ...pricing.allowances.map(({ amountMinor, description }) => ({
            description: 'Allowance · ' + description,
            total: money(amountMinor),
          })),
          ...(pricing.taxMinor > 0 ? [{ description: 'Tax', total: money(pricing.taxMinor) }] : []),
        ],
        total: money(pricing.totalMinor),
      },
    ],
    optionalAddOns: [],
    selectedOptionId: packageId,
    paymentTerms: template.paymentTerms,
    taxTreatment: template.taxTreatment,
    terms: template.terms,
    validUntil: expires + 'T12:00:00.000Z',
  });
}
