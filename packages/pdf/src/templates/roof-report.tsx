import { Document, Image, Line, Polygon, Svg, Text, View } from '@react-pdf/renderer';
import {
  EDGE_LABEL,
  EDGE_ORDER,
  PROVENANCE_LABEL,
  fixed,
  formatArea,
  formatDate,
  formatDateTime,
  formatLength,
  formatPitch,
  formatSquares,
  isMeasured,
  stableSort,
} from '../format';
import { Banner, Bullets, DocPage, INK, KeyValue, Table, TotalLine, s } from '../layout';
import type {
  EdgeCategory,
  FacetSnapshot,
  RoofReportSnapshot,
  StructureSnapshot,
} from '../snapshots';

const TITLE = 'Roof measurement report';

export interface RoofTotals {
  planAreaSqM: number;
  slopedAreaSqM: number;
  facetCount: number;
  edgesByCategory: Record<EdgeCategory, number>;
  /** Share of sloped area whose facet provenance is measured (not estimated), 0..1. */
  measuredShare: number;
}

export function structureTotals(structures: readonly StructureSnapshot[]): RoofTotals {
  const edgesByCategory = Object.fromEntries(EDGE_ORDER.map((c) => [c, 0])) as Record<
    EdgeCategory,
    number
  >;
  let plan = 0;
  let sloped = 0;
  let measured = 0;
  let facets = 0;
  for (const st of structures) {
    for (const f of st.facets) {
      plan += f.planAreaSqM;
      sloped += f.slopedAreaSqM;
      if (isMeasured(f.provenance)) measured += f.slopedAreaSqM;
      facets += 1;
    }
    for (const e of st.edges) edgesByCategory[e.category] += e.lengthM;
  }
  return {
    planAreaSqM: plan,
    slopedAreaSqM: sloped,
    facetCount: facets,
    edgesByCategory,
    measuredShare: sloped > 0 ? measured / sloped : 0,
  };
}

const DIAGRAM_W = 520;
const DIAGRAM_H = 300;

/** Vector roof diagram drawn from facet polygons (always available, needs no imagery rights). */
function RoofDiagram({ structure }: { structure: StructureSnapshot }) {
  const pts = structure.facets.flatMap((f) => f.polygon);
  if (pts.length === 0) return <Text style={s.muted}>No facets drawn.</Text>;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 16;
  const scale = Math.min(
    (DIAGRAM_W - 2 * pad) / (maxX - minX || 1),
    (DIAGRAM_H - 2 * pad) / (maxY - minY || 1),
  );
  const tx = (x: number) => Number(fixed(pad + (x - minX) * scale, 2));
  const ty = (y: number) => Number(fixed(DIAGRAM_H - pad - (y - minY) * scale, 2));
  const facets = stableSort(
    structure.facets,
    (f) => f.label,
    (f) => f.id,
  );
  return (
    <Svg width={DIAGRAM_W} height={DIAGRAM_H} viewBox={`0 0 ${DIAGRAM_W} ${DIAGRAM_H}`}>
      {facets.map((f) => (
        <Polygon
          key={f.id}
          points={f.polygon.map(([x, y]) => `${tx(x)},${ty(y)}`).join(' ')}
          fill={isMeasured(f.provenance) ? '#dcebea' : '#fbefd9'}
          stroke={INK.text}
          strokeWidth={1}
          strokeDasharray={isMeasured(f.provenance) ? undefined : '4,3'}
        />
      ))}
      {stableSort(
        structure.edges,
        (e) => e.category,
        (e) => e.id,
      )
        .filter((e) => e.category === 'ridge' || e.category === 'valley' || e.category === 'hip')
        .map((e) => (
          <Line
            key={e.id}
            x1={tx(e.from[0])}
            y1={ty(e.from[1])}
            x2={tx(e.to[0])}
            y2={ty(e.to[1])}
            stroke={e.category === 'valley' ? '#1f4f8a' : '#8a1c12'}
            strokeWidth={2}
          />
        ))}
      {facets.map((f) => {
        const cx = f.polygon.reduce((a, p) => a + p[0], 0) / f.polygon.length;
        const cy = f.polygon.reduce((a, p) => a + p[1], 0) / f.polygon.length;
        return (
          <Text
            key={`${f.id}-label`}
            x={tx(cx) - 8}
            y={ty(cy) + 3}
            style={{ fontSize: 9, fontWeight: 700 }}
            fill={INK.text}
          >
            {`${f.label}${isMeasured(f.provenance) ? '' : '*'}`}
          </Text>
        );
      })}
    </Svg>
  );
}

function facetRows(facets: readonly FacetSnapshot[]) {
  return stableSort(
    facets,
    (f) => f.label,
    (f) => f.id,
  );
}

export function RoofReportDocument({ snapshot }: { snapshot: RoofReportSnapshot }) {
  const { meta, imagery, measurementSystem: sys } = snapshot;
  const structures = stableSort(
    snapshot.structures,
    (x) => x.name,
    (x) => x.id,
  );
  const totals = structureTotals(structures);
  const approved = snapshot.approval.status === 'approved';
  return (
    <Document
      title={`${TITLE} ${meta.documentId}`}
      author={meta.organization.name}
      creator={meta.productName ?? 'Field Pro'}
      producer={meta.productName ?? 'Field Pro'}
      language={meta.locale ?? 'en-US'}
      creationDate={new Date(meta.issuedAt)}
      modificationDate={new Date(meta.issuedAt)}
    >
      <DocPage meta={meta} title={TITLE}>
        <Text style={s.h1}>{TITLE}</Text>
        <KeyValue k="Report ID" v={meta.documentId} />
        <KeyValue k="Revision" v={String(meta.revision)} />
        <KeyValue k="Report date" v={formatDate(meta.issuedAt, meta.timeZone)} />
        <KeyValue k="Property" v={snapshot.property.addressLines.join(', ')} />
        {snapshot.property.parcelId ? <KeyValue k="Parcel" v={snapshot.property.parcelId} /> : null}
        <KeyValue k="Prepared by" v={meta.organization.name} />
        {!approved ? (
          <Banner tone="warning" title="Not yet approved">
            This report has not been approved by a reviewer. Values may change.
          </Banner>
        ) : null}

        <Text style={s.h2}>Imagery provenance</Text>
        <KeyValue k="Imagery provider" v={imagery.provider} />
        {imagery.captureDate ? (
          <KeyValue k="Capture date" v={formatDate(imagery.captureDate)} />
        ) : null}
        {imagery.gsdMeters !== undefined ? (
          <KeyValue k="Resolution (GSD)" v={`${fixed(imagery.gsdMeters * 100, 1)} cm per pixel`} />
        ) : null}
        {imagery.licenseId ? <KeyValue k="License" v={imagery.licenseId} /> : null}
        {imagery.exportAllowed && imagery.imageSrc ? (
          <View wrap={false}>
            <Image src={imagery.imageSrc} style={{ width: 260, marginTop: 6 }} />
            <Text style={[s.small, s.muted]}>
              {imagery.attribution ?? `Imagery © ${imagery.provider}`}
            </Text>
          </View>
        ) : imagery.exportAllowed ? (
          <Text style={[s.small, s.muted]}>
            {imagery.attribution ?? `Imagery © ${imagery.provider}`}
          </Text>
        ) : (
          <Banner tone="info" title="Imagery not licensed for export — vector diagram shown">
            The imagery license does not permit embedding images in exported documents. The roof
            diagram below is drawn from the measured facet geometry.
          </Banner>
        )}

        <Text style={s.h2}>Whole-property totals</Text>
        <TotalLine label="Structures" value={String(structures.length)} />
        <TotalLine label="Facets" value={String(totals.facetCount)} />
        <TotalLine label="Plan (footprint) area" value={formatArea(totals.planAreaSqM, sys)} />
        <TotalLine
          label="Total roof area (sloped)"
          value={formatArea(totals.slopedAreaSqM, sys)}
          strong
        />
        <TotalLine
          label="Roofing squares (exact, before waste)"
          value={formatSquares(totals.slopedAreaSqM)}
        />
        <TotalLine
          label="Share of area field verified or user measured"
          value={`${fixed(totals.measuredShare * 100, 0)}%`}
        />
        <Text style={[s.small, s.muted]}>
          Quantities are exact measurements. Waste is shown per structure and applied once; order
          packs are rounded separately by the estimate.
        </Text>
      </DocPage>

      {structures.map((st) => {
        const t = structureTotals([st]);
        return (
          <DocPage key={st.id} meta={meta} title={TITLE}>
            <Text style={s.h2}>{`Structure: ${st.name}`}</Text>
            <View wrap={false}>
              <RoofDiagram structure={st} />
              <Text style={[s.small, s.muted]}>
                Labels marked * are estimated (machine or imagery derived); unmarked facets are
                measured. Red lines: ridges and hips. Blue lines: valleys.
              </Text>
            </View>
            <TotalLine label="Sloped area" value={formatArea(t.slopedAreaSqM, sys)} strong />
            <TotalLine label="Squares (exact)" value={formatSquares(t.slopedAreaSqM)} />
            <TotalLine
              label={`Waste factor (applied once)`}
              value={`${fixed(st.wasteFactor * 100, 0)}%`}
            />
            <TotalLine
              label="Squares including waste"
              value={formatSquares(t.slopedAreaSqM * (1 + st.wasteFactor))}
            />

            <Text style={s.h3}>Pitch table</Text>
            <Table
              rows={facetRows(st.facets)}
              rowKey={(f) => f.id}
              columns={[
                { header: 'Facet', width: '14%', cell: (f) => f.label },
                { header: 'Pitch', width: '14%', cell: (f) => formatPitch(f.pitchRisePer12) },
                {
                  header: 'Plan area',
                  width: '20%',
                  align: 'right',
                  cell: (f) => formatArea(f.planAreaSqM, sys),
                },
                {
                  header: 'Sloped area',
                  width: '20%',
                  align: 'right',
                  cell: (f) => formatArea(f.slopedAreaSqM, sys),
                },
                {
                  header: 'Source',
                  width: '32%',
                  cell: (f) =>
                    `${isMeasured(f.provenance) ? 'Measured' : 'Estimated'} · ${PROVENANCE_LABEL[f.provenance]}`,
                },
              ]}
            />

            <Text style={s.h3}>Edge category totals</Text>
            <Table
              rows={EDGE_ORDER.filter((c) => t.edgesByCategory[c] > 0)}
              rowKey={(c) => c}
              columns={[
                { header: 'Category', width: '50%', cell: (c) => EDGE_LABEL[c] },
                {
                  header: 'Length',
                  width: '50%',
                  align: 'right',
                  cell: (c) => formatLength(t.edgesByCategory[c], sys),
                },
              ]}
            />
          </DocPage>
        );
      })}

      <DocPage meta={meta} title={TITLE}>
        <Text style={s.h2}>Edge totals, whole property</Text>
        <Table
          rows={EDGE_ORDER.filter((c) => totals.edgesByCategory[c] > 0)}
          rowKey={(c) => c}
          columns={[
            { header: 'Category', width: '50%', cell: (c) => EDGE_LABEL[c] },
            {
              header: 'Length',
              width: '50%',
              align: 'right',
              cell: (c) => formatLength(totals.edgesByCategory[c], sys),
            },
          ]}
        />
        <Text style={s.h2}>Exclusions</Text>
        {snapshot.exclusions.length > 0 ? (
          <Bullets items={snapshot.exclusions} />
        ) : (
          <Text style={s.muted}>None recorded.</Text>
        )}
        <Text style={s.h2}>Review notes</Text>
        {snapshot.reviewNotes.length > 0 ? (
          stableSort(
            snapshot.reviewNotes,
            (n) => n.at,
            (n) => n.author,
          ).map((n, i) => (
            <View key={i} style={{ marginBottom: 4 }} wrap={false}>
              <Text
                style={[s.small, s.muted]}
              >{`${n.author} · ${formatDateTime(n.at, meta.timeZone)}`}</Text>
              <Text>{n.text}</Text>
            </View>
          ))
        ) : (
          <Text style={s.muted}>No review notes.</Text>
        )}
        <Text style={s.h2}>Methodology</Text>
        <Text>{snapshot.methodology}</Text>
        <Text style={s.h2}>Disclaimers</Text>
        <Bullets items={snapshot.disclaimers} />
        <Text style={s.h2}>Approval</Text>
        <View style={{ borderWidth: 0.75, borderColor: INK.rule, padding: 8 }} wrap={false}>
          <KeyValue
            k="Status"
            v={
              approved
                ? 'Approved'
                : snapshot.approval.status === 'review_required'
                  ? 'Review required'
                  : 'Draft'
            }
          />
          <KeyValue k="Approver" v={snapshot.approval.approverName ?? '—'} />
          <KeyValue k="Role" v={snapshot.approval.approverRole ?? '—'} />
          <KeyValue
            k="Approved at"
            v={
              snapshot.approval.approvedAt
                ? formatDateTime(snapshot.approval.approvedAt, meta.timeZone)
                : '—'
            }
          />
        </View>
      </DocPage>
    </Document>
  );
}
