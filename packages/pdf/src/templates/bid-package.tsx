import { Document, Text } from '@react-pdf/renderer';
import { formatDate, formatMoney } from '../format';
import { Banner, Bullets, DocPage, KeyValue, Table, s } from '../layout';
import type { BidPackageSnapshot } from '../snapshots';

const TITLE = 'Bid package — DRAFT';

const money = (cents: number | null) =>
  cents === null ? 'Price missing' : formatMoney({ amountMinor: cents, currency: 'USD' });

const qty = (q: number | null, unit: string) => (q === null ? 'Not stated' : `${q} ${unit}`);

export function BidPackageDocument({ snapshot }: { snapshot: BidPackageSnapshot }) {
  const approved = snapshot.lines.filter((l) => l.approved);
  const unapproved = snapshot.lines.filter((l) => !l.approved);
  return (
    <Document
      title={`${TITLE} ${snapshot.meta.documentId}`}
      author={snapshot.meta.organization.name}
      creator={snapshot.meta.productName ?? 'Field Pro'}
      producer={snapshot.meta.productName ?? 'Field Pro'}
      language={snapshot.meta.locale ?? 'en-US'}
      creationDate={new Date(snapshot.meta.issuedAt)}
      modificationDate={new Date(snapshot.meta.issuedAt)}
    >
      <DocPage meta={snapshot.meta} title={TITLE}>
        <Text style={s.h1}>{TITLE}</Text>
        <KeyValue k="Project" v={snapshot.projectName} />
        <KeyValue k="Contractor" v={snapshot.meta.organization.name} />
        <KeyValue k="Issued" v={formatDate(snapshot.meta.issuedAt.slice(0, 10))} />
        <KeyValue k="Document" v={snapshot.meta.documentId} />

        <Banner tone="warning" title="DRAFT — review-ready, not a sent proposal">
          Every line below was reviewed in Field Pro, but this document was not sent to anyone and
          is not a proposal. Prices are contractor-entered or from the sources shown; a line with
          no price is not included in any total.
        </Banner>

        <Text style={s.h2}>Approved lines by trade</Text>
        <Table
          columns={[
            { header: 'Trade', width: '20%', cell: (r) => r.tradeLabel },
            { header: 'Item', width: '34%', cell: (r) => r.label },
            { header: 'Qty', width: '14%', align: 'right', cell: (r) => qty(r.quantity, r.unit) },
            { header: 'Unit price', width: '14%', align: 'right', cell: (r) => money(r.unitPriceCents) },
            { header: 'Amount', width: '18%', align: 'right', cell: (r) => money(r.amountCents) },
          ]}
          rows={approved}
          rowKey={(r) => `${r.trade}:${r.label}`}
        />
        {unapproved.length > 0 ? (
          <>
            <Text style={s.h2}>Not approved — excluded from the totals</Text>
            <Bullets items={unapproved.map((l) => `${l.tradeLabel}: ${l.label}`)} />
          </>
        ) : null}

        <Text style={s.h2}>Labor & subcontractors</Text>
        {snapshot.tradeCosts.filter((c) => c.amountCents > 0).length > 0 ? (
          <Table
            columns={[
              { header: 'Trade', width: '34%', cell: (r) => r.tradeLabel },
              { header: 'Labor', width: '22%', align: 'right', cell: (r) => (r.laborHours === null || r.laborRateCents === null ? 'Not priced' : `${r.laborHours} h × ${money(r.laborRateCents)}`) },
              { header: 'Subcontractor', width: '22%', align: 'right', cell: (r) => (r.subcontractorCents === null ? '—' : money(r.subcontractorCents)) },
              { header: 'Amount', width: '22%', align: 'right', cell: (r) => money(r.amountCents) },
            ]}
            rows={snapshot.tradeCosts.filter((c) => c.amountCents > 0)}
            rowKey={(r) => r.tradeLabel}
          />
        ) : (
          <Text style={s.muted}>No labor or subcontractor amounts entered.</Text>
        )}

        <Text style={s.h2}>Totals</Text>
        <KeyValue k="Materials (approved, priced lines)" v={money(snapshot.materialTotalCents)} />
        <KeyValue k="Labor" v={money(snapshot.laborTotalCents)} />
        <KeyValue k="Subcontractors" v={money(snapshot.subcontractorTotalCents)} />
        <KeyValue
          k={snapshot.totalCents === null ? 'Total (partial — unpriced lines excluded)' : 'Total'}
          v={snapshot.totalCents === null ? `${money(snapshot.materialTotalCents + snapshot.laborTotalCents + snapshot.subcontractorTotalCents)} (partial)` : money(snapshot.totalCents)}
        />
        {snapshot.unpricedLines > 0 ? (
          <Text style={s.muted}>
            {`${snapshot.unpricedLines} approved line(s) have no price and are not in the total. Price them before sending this as a bid.`}
          </Text>
        ) : null}

        {snapshot.notes.length > 0 ? (
          <>
            <Text style={s.h2}>Notes, exclusions & assumptions</Text>
            <Bullets items={snapshot.notes} />
          </>
        ) : null}
      </DocPage>
    </Document>
  );
}
