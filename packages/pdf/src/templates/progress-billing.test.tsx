import { describe, expect, it } from 'vitest';
import { collectText, documentFor, renderToBuffer } from '../index';
import type { ProgressBillingSnapshot } from '../snapshots';

const fixture: ProgressBillingSnapshot = {
  kind: 'progress_billing',
  meta: {
    documentId: 'PB-2026-11-26-1234',
    revision: 1,
    issuedAt: '2026-11-26T12:00:00.000Z',
    organization: { name: 'Alam Construction LLC' },
    productName: 'Field Pro',
  },
  projectName: 'Maple St Residence',
  applicationNumber: 2,
  periodStart: '2026-11-01',
  periodEnd: '2026-11-30',
  status: 'approved',
  retainagePct: 10,
  lines: [
    {
      itemNumber: '01',
      description: 'Site work',
      scheduledValueCents: 100_000,
      percentComplete: 40,
      completedToDateCents: 40_000,
      storedMaterialsCents: 0,
      previousCompletedStoredCents: 0,
      thisPeriodCents: 40_000,
      balanceToFinishCents: 60_000,
    },
  ],
  scheduledTotalCents: 100_000,
  completedStoredTotalCents: 40_000,
  previousCompletedStoredCents: 0,
  thisPeriodGrossCents: 40_000,
  retainageToDateCents: 4_000,
  retainageThisPeriodCents: 4_000,
  currentDueCents: 36_000,
  balanceToFinishCents: 60_000,
  invoiceNumber: null,
};

describe('progress billing PDF', () => {
  it('renders and states it is not an AIA form', async () => {
    const text = collectText(documentFor(fixture));
    expect(text).toContain('not an AIA');
    expect(text).toContain('Site work');
    expect(text).toContain('Current amount due');
    const rendered = await renderToBuffer(fixture);
    expect(rendered.buffer.length).toBeGreaterThan(1000);
    expect(rendered.pageCount).toBeGreaterThanOrEqual(1);
  });
});
