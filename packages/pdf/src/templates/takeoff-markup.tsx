import { Circle, Document, G, Image, Page, Path, Rect, Svg, Text, View } from '@react-pdf/renderer';
import { FONT_FAMILY, INK, KeyValue, s } from '../layout';
import type { TakeoffMarkupSnapshot } from '../snapshots';

const layers = {
  length: { label: 'Length', color: '#005ab5', symbol: 'Solid line' },
  area: { label: 'Net area', color: '#007c52', symbol: 'Shaded area, with clear deductions' },
  count: { label: 'Count', color: '#9b3675', symbol: 'Object marker' },
};

export function TakeoffMarkupDocument({ snapshot }: { snapshot: TakeoffMarkupSnapshot }) {
  const { meta, drawing } = snapshot;
  const date = new Date(meta.issuedAt);
  const sheet = 'Sheet ' + snapshot.sheetLabel + ' · Revision ' + snapshot.revisionLabel;
  const scale = Math.min(1, 1460 / Math.max(drawing.width, drawing.height));
  const width = drawing.width * scale;
  const height = drawing.height * scale;

  return (
    <Document
      title={snapshot.planTitle + ' · Takeoff markup'}
      author={meta.organization.name}
      creationDate={date}
      modificationDate={date}
      language="en"
    >
      <Page
        size={[Math.max(480, width + 48), height + 108]}
        wrap={false}
        style={{ fontFamily: FONT_FAMILY, color: INK.text, padding: 24 }}
      >
        <Text style={{ fontSize: 14, fontWeight: 700 }}>{snapshot.planTitle}</Text>
        <Text style={{ fontSize: 10, marginTop: 2, marginBottom: 8 }}>{sheet}</Text>
        <View style={{ width, height }}>
          <Image
            src={drawing.image}
            style={{ position: 'absolute', top: 0, left: 0, width, height }}
          />
          <Svg width={width} height={height} viewBox={`0 0 ${drawing.width} ${drawing.height}`}>
            {drawing.marks.map((mark) =>
              mark.kind === 'count' ? (
                <G
                  key={mark.id}
                  transform={'translate(' + mark.x + ' ' + mark.y + ')'}
                  fill={layers.count.color}
                  stroke="#fff"
                  strokeWidth={1.2}
                >
                  {mark.symbol === 'circle' && <Circle r={7} />}
                  {mark.symbol === 'square' && <Rect x={-7} y={-7} width={14} height={14} />}
                  {mark.symbol === 'triangle' && <Path d="M0 -8 L8 7 H-8 Z" />}
                  {mark.symbol === 'cross' && (
                    <Path d="M-2 -8 H2 V-2 H8 V2 H2 V8 H-2 V2 H-8 V-2 H-2 Z" />
                  )}
                </G>
              ) : (
                <Path
                  key={mark.id}
                  d={mark.path}
                  fill={mark.kind === 'area' ? layers.area.color : 'none'}
                  fillOpacity={mark.kind === 'area' ? 0.2 : 1}
                  fillRule="evenodd"
                  stroke={layers[mark.kind].color}
                  strokeWidth={2.5}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ),
            )}
          </Svg>
          <Text
            style={{
              position: 'absolute',
              bottom: 8,
              right: 8,
              color: INK.muted,
              backgroundColor: '#ffffff',
              opacity: 0.83,
              fontWeight: 700,
              fontSize: 15,
              padding: 4,
            }}
          >
            {'Revision ' + snapshot.revisionLabel}
          </Text>
        </View>
        <Text style={{ fontSize: 9, marginTop: 8 }}>{'Scale · ' + snapshot.scaleLabel}</Text>
      </Page>
      <Page size="A4" style={s.page}>
        <Text style={s.h1}>Takeoff markup legend</Text>
        <KeyValue k="Drawing" v={snapshot.planTitle} />
        <KeyValue k="Sheet and revision" v={sheet} />
        <KeyValue k="Scale" v={snapshot.scaleLabel} />
        <KeyValue k="Export ID" v={meta.documentId} />
        <Text style={s.h2}>Selected approved totals</Text>
        {snapshot.totals.map((total) => {
          const layer = layers[total.layer];
          return (
            <View key={total.layer + '/' + total.unit} style={s.tr} wrap={false}>
              <Text style={{ width: 105, color: layer.color, fontWeight: 700 }}>{layer.label}</Text>
              <Text style={{ flex: 1 }}>{layer.symbol}</Text>
              <Text>{total.quantity + ' ' + total.unit}</Text>
            </View>
          );
        })}
        <Text style={[s.small, s.muted, { marginTop: 12 }]}>
          {snapshot.approvedCount + ' approved measurements'}
        </Text>
      </Page>
    </Document>
  );
}
