import { Document, G, Image, Page, Path, Svg, Text, View } from '@react-pdf/renderer';
import { formatDate } from '../format';
import { Banner, Bullets, INK, KeyValue, Table, s } from '../layout';
import type { MapPlanSheetSnapshot } from '../snapshots';

const TITLE = 'GIS Workbench plan sheet';

/**
 * North arrow: points to true north on the printed sheet. The map bearing rotates the view, so
 * the arrow rotates by the inverse bearing (a map turned 30° clockwise has north 30°
 * counter-clockwise on the sheet).
 */
function NorthArrow({ bearing }: { bearing: number }) {
  const rotation = -bearing;
  return (
    <View style={{ alignItems: 'center', width: 48 }}>
      <Svg width={36} height={36} viewBox="0 0 36 36">
        <G transform={`rotate(${rotation} 18 18)`}>
          <Path d="M18 2 L23 20 L18 16 L13 20 Z" fill={INK.primary} />
          <Path d="M18 34 L21 22 L18 24.5 L15 22 Z" fill={INK.muted} />
        </G>
      </Svg>
      <Text style={{ fontSize: 8, fontWeight: 700, color: INK.primary }}>N</Text>
    </View>
  );
}

/** Alternating-segment scale bar. Width is a fraction of the map frame; the caption is approximate at the map centre. */
function ScaleBar({ label, widthFraction }: { label: string; widthFraction: number }) {
  const segments = 4;
  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          width: `${Math.max(4, Math.min(100, widthFraction * 100))}%`,
          borderWidth: 0.75,
          borderColor: INK.text,
        }}
      >
        {Array.from({ length: segments }, (_, i) => (
          <View
            key={i}
            style={{
              flex: 1,
              height: 5,
              backgroundColor: i % 2 === 0 ? INK.text : '#ffffff',
            }}
          />
        ))}
      </View>
      <Text style={{ fontSize: 8, color: INK.muted, marginTop: 2 }}>
        {label} (scale approximate at map centre)
      </Text>
    </View>
  );
}

export function MapPlanSheetDocument({ snapshot }: { snapshot: MapPlanSheetSnapshot }) {
  const { meta } = snapshot;
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
      <Page size={snapshot.pageSize} orientation={snapshot.orientation} style={s.page}>
        <View style={s.header} fixed>
          <Text>{meta.organization.name}</Text>
          <Text>{`${TITLE} · ${meta.documentId} · Rev ${meta.revision}`}</Text>
        </View>

        <Text style={s.h1}>{snapshot.title}</Text>
        <Banner tone="warning" title="DRAFT PLAN SHEET — not a survey">
          Planning sheet printed from the GIS Workbench map view. Boundaries, streams and parcels
          are as published by the sources below; verify on site with a surveyor before building,
          digging or pricing from this sheet.
        </Banner>

        <View style={{ borderWidth: 1, borderColor: INK.text, marginTop: 4 }}>
          <Image src={snapshot.mapImageDataUrl} style={{ width: '100%' }} />
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            marginTop: 8,
          }}
        >
          <ScaleBar label={snapshot.scaleBarLabel} widthFraction={snapshot.scaleBarWidthFraction} />
          <Text style={{ fontSize: 8, color: INK.muted, marginHorizontal: 10 }}>
            {`Centre ${snapshot.centerLat.toFixed(5)}°, ${snapshot.centerLon.toFixed(5)}° · zoom ${snapshot.zoom.toFixed(1)} · bearing ${snapshot.bearing.toFixed(0)}°`}
          </Text>
          <NorthArrow bearing={snapshot.bearing} />
        </View>

        <Text style={s.h2}>Legend</Text>
        {snapshot.legend.length === 0 ? (
          <Text style={s.muted}>No data layers were visible in this view.</Text>
        ) : (
          snapshot.legend.map((entry, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 3 }}>
              <View
                style={{
                  width: 14,
                  height: 10,
                  backgroundColor: entry.color,
                  borderWidth: 0.5,
                  borderColor: INK.text,
                  marginRight: 6,
                }}
              />
              <Text>{entry.label}</Text>
            </View>
          ))
        )}

        <Text style={s.h2}>Layers in this view</Text>
        <Table
          columns={[
            { header: 'Layer', width: '40%', cell: (r) => r.label },
            { header: 'Features', width: '20%', align: 'right', cell: (r) => String(r.featureCount) },
            { header: 'Status', width: '40%', cell: (r) => r.status },
          ]}
          rows={snapshot.layerSummary}
          rowKey={(r, i) => `${i}-${r.label}`}
        />

        <Text style={s.h2}>Sources and notes</Text>
        <Bullets items={snapshot.sourceNotes} />
        <KeyValue k="Generated" v={formatDate(meta.issuedAt.slice(0, 10), meta.timeZone)} />
        <KeyValue k="Document" v={`${meta.documentId} · Rev ${meta.revision}`} />

        <View style={s.footer} fixed>
          <Text>
            {`Issued ${formatDate(meta.issuedAt, meta.timeZone)}${meta.productName ? ` · Prepared with ${meta.productName}` : ''} · DRAFT plan sheet — not a survey`}
          </Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
