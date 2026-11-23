import { Document, Image, Text, View } from '@react-pdf/renderer';
import { formatDate, formatMoney } from '../format';
import { Banner, DocPage, KeyValue, Table, TotalLine, s } from '../layout';
import type { InspectionMarkerSnapshot, RoofInspectionSnapshot } from '../snapshots';

const TITLE = 'Roof photo inspection report';

export interface InspectionTotals {
  totalMarkers: number;
  passCount: number;
  monitorCount: number;
  failCount: number;
  overall: 'pass' | 'monitor' | 'fail';
  pricedTotalMinor: number;
  currency: string;
  missingPriceCount: number;
}

export function inspectionTotals(snapshot: RoofInspectionSnapshot): InspectionTotals {
  const markers = snapshot.photos.flatMap((p) => p.markers);
  let pricedTotalMinor = 0;
  let missingPriceCount = 0;
  let currency = 'USD';
  for (const m of markers) {
    if (m.price) {
      pricedTotalMinor += m.price.amountMinor;
      currency = m.price.currency;
    } else {
      missingPriceCount += 1;
    }
  }
  const failCount = markers.filter((m) => m.result === 'fail').length;
  const monitorCount = markers.filter((m) => m.result === 'monitor').length;
  return {
    totalMarkers: markers.length,
    passCount: markers.filter((m) => m.result === 'pass').length,
    monitorCount,
    failCount,
    overall: failCount > 0 ? 'fail' : monitorCount > 0 ? 'monitor' : 'pass',
    pricedTotalMinor,
    currency,
    missingPriceCount,
  };
}

function priceText(marker: InspectionMarkerSnapshot): string {
  return marker.price ? formatMoney(marker.price) : 'Price missing';
}

export function RoofInspectionDocument({ snapshot }: { snapshot: RoofInspectionSnapshot }) {
  const totals = inspectionTotals(snapshot);
  const overallLabel =
    totals.overall === 'fail' ? 'FAIL' : totals.overall === 'monitor' ? 'MONITOR' : 'PASS';
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
      <KeyValue k="Customer" v={snapshot.customer.name} />
      <KeyValue k="Address" v={snapshot.customer.addressLines.join(', ')} />
      <KeyValue k="Inspector" v={snapshot.inspector} />
      <KeyValue
        k="Inspection date"
        v={snapshot.inspectionDate ? formatDate(snapshot.inspectionDate) : 'Not recorded'}
      />
      <Banner
        tone={totals.overall === 'fail' ? 'danger' : totals.overall === 'monitor' ? 'warning' : 'ok'}
        title={`Overall: ${overallLabel}`}
      >
        {`${totals.failCount} fail · ${totals.monitorCount} monitor · ${totals.passCount} pass (${totals.totalMarkers} findings)`}
      </Banner>

      {snapshot.photos.map((photo) => (
        <View key={photo.id}>
          <Text style={s.h2}>{photo.name}</Text>
          {photo.imageSrc ? (
            <View style={{ position: 'relative', width: 520, marginBottom: 8 }}>
              <Image src={photo.imageSrc} style={{ width: 520 }} />
              {photo.markers.map((m, i) => (
                <Text
                  key={m.id}
                  style={{
                    position: 'absolute',
                    left: `${Math.min(100, Math.max(0, m.x * 100))}%`,
                    top: `${Math.min(100, Math.max(0, m.y * 100))}%`,
                    backgroundColor: '#b00020',
                    color: '#ffffff',
                    fontSize: 9,
                    padding: 2,
                  }}
                >
                  {String(i + 1)}
                </Text>
              ))}
            </View>
          ) : (
            <Text style={s.muted}>Photo not included in this document.</Text>
          )}
          {photo.markers.length > 0 ? (
            <Table
              columns={[
                { header: '#', width: '6%', cell: (r) => String(photo.markers.indexOf(r) + 1) },
                { header: 'Finding', width: '28%', cell: (r) => r.findingLabel },
                { header: 'Severity', width: '14%', cell: (r) => r.severity },
                { header: 'Result', width: '12%', cell: (r) => r.result },
                { header: 'Note', width: '24%', cell: (r) => r.note },
                { header: 'Price', width: '16%', align: 'right', cell: (r) => priceText(r) },
              ]}
              rows={photo.markers}
              rowKey={(r) => r.id}
            />
          ) : (
            <Text style={s.muted}>No findings marked on this photo.</Text>
          )}
        </View>
      ))}

      <TotalLine
        label="Priced total"
        value={formatMoney({ amountMinor: totals.pricedTotalMinor, currency: totals.currency })}
        strong
      />
      {totals.missingPriceCount > 0 ? (
        <Text style={s.muted}>
          {`${totals.missingPriceCount} finding(s) still need a price — not final. Blank prices are shown as missing, never invented.`}
        </Text>
      ) : null}
      {snapshot.disclaimers.map((d, i) => (
        <Text key={i} style={s.muted}>
          {d}
        </Text>
      ))}
      </DocPage>
    </Document>
  );
}
