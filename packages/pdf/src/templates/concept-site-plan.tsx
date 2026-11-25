import { Document, G, Rect, Svg, Text, View } from '@react-pdf/renderer';
import { formatDate } from '../format';
import { Banner, Bullets, DocPage, INK, KeyValue, Table, s } from '../layout';
import type { ConceptSitePlanSnapshot } from '../snapshots';

const TITLE = 'Concept site plan';

/** Lot colours match the 3D site plan legend: passes, flood warning, breaks a rule. */
const LOT_FILL = { ok: '#dff2e6', warn: '#fdf3d7', bad: '#fde3e0' };
const LOT_STROKE = { ok: '#1d5a32', warn: '#6b3a00', bad: '#8a1c12' };

const fmt = (n: number) => Math.round(n).toLocaleString('en-US');

/**
 * The lot plan drawn to scale from parcel-feet coordinates. z = 0 is the existing street
 * edge, drawn at the bottom of the sheet; the drawing is a concept layout, not a survey.
 */
function PlanDrawing({ snapshot }: { snapshot: ConceptSitePlanSnapshot }) {
  const W = Math.max(1, snapshot.parcelWidthFt);
  const D = Math.max(1, snapshot.parcelDepthFt);
  // Fit the page content width (~507 pt on LETTER with the standard margins), cap the height.
  const width = 507;
  const height = Math.min(400, Math.max(120, (width * D) / W));
  const flipY = (z: number) => D - z; // street edge at the bottom
  const fontSize = Math.max(6, Math.min(14, W / 28));
  return (
    <View style={{ borderWidth: 1, borderColor: INK.text, marginTop: 4 }}>
      <Svg width={width} height={height} viewBox={`0 0 ${W} ${D}`} preserveAspectRatio="xMidYMid meet">
        <Rect x={0} y={0} width={W} height={D} fill="#f4f6f2" />
        {snapshot.road && (
          <Rect
            x={snapshot.road.x0}
            y={flipY(snapshot.road.z1)}
            width={snapshot.road.x1 - snapshot.road.x0}
            height={snapshot.road.z1 - snapshot.road.z0}
            fill="#c9cfcc"
          />
        )}
        {snapshot.lots.map((lot) => {
          const tone = !lot.passes ? 'bad' : lot.hasIssues ? 'warn' : 'ok';
          return (
            <G key={lot.number}>
              <Rect
                x={lot.rect.x0}
                y={flipY(lot.rect.z1)}
                width={lot.rect.x1 - lot.rect.x0}
                height={lot.rect.z1 - lot.rect.z0}
                fill={LOT_FILL[tone]}
                stroke={LOT_STROKE[tone]}
                strokeWidth={Math.max(0.6, W / 500)}
              />
              {lot.home && (
                <Rect
                  x={lot.home.x0}
                  y={flipY(lot.home.z1)}
                  width={lot.home.x1 - lot.home.x0}
                  height={lot.home.z1 - lot.home.z0}
                  fill="#ffffff"
                  stroke={INK.text}
                  strokeWidth={Math.max(0.6, W / 500)}
                />
              )}
              <Text
                x={(lot.rect.x0 + lot.rect.x1) / 2}
                y={flipY((lot.rect.z0 + lot.rect.z1) / 2)}
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ fontSize, fill: INK.text, fontWeight: 700 }}
              >
                {String(lot.number)}
              </Text>
            </G>
          );
        })}
        <Rect x={0} y={0} width={W} height={D} fill="none" stroke={INK.text} strokeWidth={Math.max(1, W / 300)} />
      </Svg>
    </View>
  );
}

export function ConceptSitePlanDocument({ snapshot }: { snapshot: ConceptSitePlanSnapshot }) {
  const { meta } = snapshot;
  const passing = snapshot.lots.filter((l) => l.passes).length;
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
        <Text style={s.h1}>{snapshot.projectName}</Text>
        <Text style={{ fontSize: 11, color: INK.muted, marginBottom: 4 }}>
          Concept for Discussion — concept site plan
        </Text>
        <Banner tone="warning" title="CONCEPT FOR DISCUSSION — not a survey, plat or zoning approval">
          A planning concept from a land-feasibility run. Lot lines, home footprints and figures
          are estimates from the builder&apos;s inputs; confirm boundaries, zoning, utilities and
          pricing with a surveyor, the city and your cost book before relying on this sheet.
        </Banner>

        <KeyValue k="Parcel" v={`${fmt(snapshot.parcelWidthFt)} ft × ${fmt(snapshot.parcelDepthFt)} ft (${snapshot.acres.toFixed(2)} acres)`} />
        <KeyValue k="Lots shown" v={`${snapshot.lots.length} (${passing} pass the entered rules)`} />
        {snapshot.homeFootprint && (
          <KeyValue
            k="Home footprint"
            v={`${fmt(snapshot.homeFootprint.widthFt)} ft × ${fmt(snapshot.homeFootprint.depthFt)} ft`}
          />
        )}
        <KeyValue k="Exit plan" v={snapshot.exitPlanLabel} />
        <KeyValue k="Generated" v={formatDate(meta.issuedAt.slice(0, 10), meta.timeZone)} />

        <Text style={s.h2}>Concept lot plan</Text>
        <PlanDrawing snapshot={snapshot} />
        <Text style={[s.small, s.muted, { marginTop: 4 }]}>
          Existing street along the bottom edge. Lot colours: green passes the entered rules,
          amber passes with a warning, red breaks a rule. White boxes are home footprints.
          Drawing is to scale from the parcel dimensions above; it is not a survey.
        </Text>

        <Text style={s.h2}>Lot schedule</Text>
        <Table
          columns={[
            { header: 'Lot', width: '12%', cell: (r) => String(r.number) },
            { header: 'Size (sq ft)', width: '24%', align: 'right', cell: (r) => fmt(r.areaSqft) },
            {
              header: 'Home placed',
              width: '20%',
              cell: (r) => (r.home ? 'Yes' : 'No'),
            },
            {
              header: 'Rule check',
              width: '44%',
              cell: (r) => (!r.passes ? 'Breaks a rule' : r.hasIssues ? 'Passes with warning' : 'Passes'),
            },
          ]}
          rows={snapshot.lots}
          rowKey={(r) => String(r.number)}
        />

        <Text style={s.h2}>Underwriting summary (estimates)</Text>
        <Table
          columns={[
            { header: 'Item', width: '60%', cell: (r) => r.label },
            { header: 'Figure', width: '40%', align: 'right', cell: (r) => r.value },
          ]}
          rows={snapshot.summaryLines}
          rowKey={(r, i) => `${i}-${r.label}`}
        />

        <Text style={s.h2}>Assumptions</Text>
        <Bullets items={snapshot.assumptions} />

        {snapshot.disclaimers.map((d, i) => (
          <Text key={i} style={[s.muted, { marginTop: 6 }]}>
            {d}
          </Text>
        ))}
      </DocPage>
    </Document>
  );
}
