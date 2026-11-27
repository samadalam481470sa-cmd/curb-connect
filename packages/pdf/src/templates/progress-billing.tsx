import { Document, Text } from '@react-pdf/renderer';
import { formatDate, formatMoney } from '../format';
import { Banner, DocPage, KeyValue, Table, s } from '../layout';
import type { ProgressBillingSnapshot } from '../snapshots';

const TITLE = 'Progress billing application';

const money = (cents: number) => formatMoney({ amountMinor: cents, currency: 'USD' });

export function ProgressBillingDocument({ snapshot }: { snapshot: ProgressBillingSnapshot }) {
  return (
    <Document
      title={`${TITLE} #${snapshot.applicationNumber} ${snapshot.meta.documentId}`}
      author={snapshot.meta.organization.name}
      creator={snapshot.meta.productName ?? 'Field Pro'}
      producer={snapshot.meta.productName ?? 'Field Pro'}
      language={snapshot.meta.locale ?? 'en-US'}
      creationDate={new Date(snapshot.meta.issuedAt)}
      modificationDate={new Date(snapshot.meta.issuedAt)}
    >
      <DocPage meta={snapshot.meta} title={TITLE}>
        <Text style={s.h1}>{TITLE} #{snapshot.applicationNumber}</Text>
        <KeyValue k="Project" v={snapshot.projectName} />
        <KeyValue k="Contractor" v={snapshot.meta.organization.name} />
        <KeyValue k="Period" v={`${formatDate(snapshot.periodStart)} – ${formatDate(snapshot.periodEnd)}`} />
        <KeyValue k="Status" v={snapshot.status} />
        <KeyValue k="Retainage" v={`${snapshot.retainagePct}% (contract term as entered)`} />
        {snapshot.invoiceNumber ? <KeyValue k="Invoice" v={snapshot.invoiceNumber} /> : null}
        <KeyValue k="Document" v={snapshot.meta.documentId} />

        <Banner tone="warning" title="Generic progress billing application — not an AIA form">
          This is a Field Pro progress billing application generated from the contractor-entered
          schedule of values, percents complete, and stored materials. It is not an AIA document
          and carries no AIA certification. Amounts due are this period’s work less retainage
          withheld at the entered contract rate.
        </Banner>

        <Text style={s.h2}>Schedule of values — work completed</Text>
        <Table
          columns={[
            { header: 'Item', width: 1, cell: (r) => r.itemNumber || '—' },
            { header: 'Description', width: 3, cell: (r) => r.description },
            { header: 'Scheduled', width: 2, align: 'right', cell: (r) => money(r.scheduledValueCents) },
            { header: '%', width: 1, align: 'right', cell: (r) => `${r.percentComplete}%` },
            { header: 'Completed', width: 2, align: 'right', cell: (r) => money(r.completedToDateCents) },
            { header: 'Stored', width: 2, align: 'right', cell: (r) => money(r.storedMaterialsCents) },
            { header: 'Previous', width: 2, align: 'right', cell: (r) => money(r.previousCompletedStoredCents) },
            { header: 'This period', width: 2, align: 'right', cell: (r) => money(r.thisPeriodCents) },
            { header: 'Balance', width: 2, align: 'right', cell: (r) => money(r.balanceToFinishCents) },
          ]}
          rows={snapshot.lines}
          rowKey={(r, i) => `${r.itemNumber}-${i}`}
        />

        <Text style={s.h2}>Totals</Text>
        <KeyValue k="Total scheduled value" v={money(snapshot.scheduledTotalCents)} />
        <KeyValue k="Completed + stored to date" v={money(snapshot.completedStoredTotalCents)} />
        <KeyValue k="Previously billed (gross)" v={money(snapshot.previousCompletedStoredCents)} />
        <KeyValue k="This period (gross)" v={money(snapshot.thisPeriodGrossCents)} />
        <KeyValue k="Retainage withheld to date" v={money(snapshot.retainageToDateCents)} />
        <KeyValue k="Retainage withheld this period" v={money(snapshot.retainageThisPeriodCents)} />
        <KeyValue k="Current amount due" v={money(snapshot.currentDueCents)} />
        <KeyValue k="Balance to finish" v={money(snapshot.balanceToFinishCents)} />
      </DocPage>
    </Document>
  );
}
