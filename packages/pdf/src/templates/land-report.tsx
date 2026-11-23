import { Document, Text } from '@react-pdf/renderer';
import { formatDate } from '../format';
import { Banner, Bullets, DocPage, KeyValue, Table, s } from '../layout';
import type { LandReportSnapshot } from '../snapshots';

const TITLE = 'Land Scout due-diligence report';

const orUnknown = (v: string | null) => v ?? 'Not published';

export function LandReportDocument({ snapshot }: { snapshot: LandReportSnapshot }) {
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
        <KeyValue k="County" v={snapshot.countyLabel} />
        <KeyValue k="Parcel / account" v={snapshot.parcelId} />
        <KeyValue k="Situs address" v={orUnknown(snapshot.situsAddress)} />
        <KeyValue k="Owner of record" v={orUnknown(snapshot.ownerName)} />
        <KeyValue k="Owner mailing" v={orUnknown(snapshot.ownerMailing)} />
        <KeyValue k="Acres" v={snapshot.acres !== null ? String(snapshot.acres) : 'Not published'} />
        <KeyValue k="Appraisal use (not city zoning)" v={orUnknown(snapshot.appraisalUse)} />
        <KeyValue k="CAD land value" v={orUnknown(snapshot.landValueText)} />
        <KeyValue k="CAD market value" v={orUnknown(snapshot.marketValueText)} />
        <KeyValue k="Nearest highway" v={orUnknown(snapshot.highwayText)} />
        <KeyValue k="Nearest substation" v={orUnknown(snapshot.substationText)} />
        <KeyValue k="FEMA flood zone" v={orUnknown(snapshot.floodText)} />
        <KeyValue k="Terrain" v={orUnknown(snapshot.terrainSummary)} />
        <KeyValue k="Data vintage" v={orUnknown(snapshot.vintage)} />
        <KeyValue k="Source" v={snapshot.source} />
        <KeyValue k="Generated" v={formatDate(snapshot.generatedAt.slice(0, 10))} />

        <Banner
          tone={snapshot.totalScore === null ? 'warning' : snapshot.totalScore >= 70 ? 'ok' : snapshot.totalScore >= 40 ? 'warning' : 'danger'}
          title={
            snapshot.totalScore === null
              ? 'Land score: not enough data to score'
              : `Land score: ${snapshot.totalScore} / 100 (${snapshot.factorsKnown} of 4 factors scored)`
          }
        >
          Unknown factors are excluded and the weights renormalized — never zero-filled.
        </Banner>

        <Text style={s.h2}>Score breakdown</Text>
        <Table
          columns={[
            { header: 'Factor', width: '22%', cell: (r) => r.label },
            { header: 'Weight', width: '12%', align: 'right', cell: (r) => `${r.weightPercent}%` },
            {
              header: 'Score',
              width: '14%',
              align: 'right',
              cell: (r) => (r.score === null ? 'Not scored' : String(r.score)),
            },
            { header: 'Detail', width: '52%', cell: (r) => r.detail },
          ]}
          rows={snapshot.factors}
          rowKey={(r) => r.label}
        />

        <Text style={s.h2}>Red flags & checks</Text>
        <Bullets items={snapshot.redFlags} />

        {snapshot.ownerIsEntity ? (
          <Text style={s.muted}>
            {`The owner looks like a company. Look up its registered agent via Texas SOSDirect: ${snapshot.sosLookupUrl}`}
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
