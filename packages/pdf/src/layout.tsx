import { Font, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import type { ReactNode } from 'react';
import { fileURLToPath } from 'node:url';
import { formatDate } from './format';
import type { DocumentMeta } from './snapshots';

/**
 * Fonts are embedded from files shipped in this package (Open Sans, Apache License 2.0, see
 * fonts/LICENSE-Apache-2.0.txt), so output never depends on fonts installed on the host.
 */
export const FONT_FAMILY = 'FieldlineSans';
let registered = false;
export function registerFonts(): void {
  if (registered) return;
  const file = (name: string) => fileURLToPath(new URL(`../fonts/${name}`, import.meta.url));
  Font.register({
    family: FONT_FAMILY,
    fonts: [
      { src: file('OpenSans-Regular.ttf'), fontWeight: 400 },
      { src: file('OpenSans-Italic.ttf'), fontWeight: 400, fontStyle: 'italic' },
      { src: file('OpenSans-SemiBold.ttf'), fontWeight: 600 },
      { src: file('OpenSans-Bold.ttf'), fontWeight: 700 },
    ],
  });
  // Deterministic line breaking: no hyphenation dictionary differences between hosts.
  Font.registerHyphenationCallback((word) => [word]);
  registered = true;
}

/** Print palette: dark ink on white, all text pairs well above WCAG AA for print and screen. */
export const INK = {
  text: '#14212b',
  muted: '#4a5660',
  rule: '#c9cfcc',
  band: '#eef1ef',
  primary: '#0f5b5c',
  warnBg: '#fff2d6',
  warnFg: '#6b3a00',
  dangerBg: '#fde3e0',
  dangerFg: '#8a1c12',
  okBg: '#e2f3e8',
  okFg: '#1d5a32',
  estimated: '#7a4a00',
};

export const s = StyleSheet.create({
  page: {
    fontFamily: FONT_FAMILY,
    fontSize: 9.5,
    color: INK.text,
    paddingTop: 54,
    paddingBottom: 54,
    paddingHorizontal: 44,
    lineHeight: 1.35,
  },
  header: {
    position: 'absolute',
    top: 20,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 8,
    color: INK.muted,
    borderBottomWidth: 0.75,
    borderBottomColor: INK.rule,
    paddingBottom: 4,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 44,
    right: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7.5,
    color: INK.muted,
  },
  h1: { fontSize: 20, fontWeight: 700, color: INK.primary, marginBottom: 6 },
  h2: { fontSize: 13, fontWeight: 700, marginTop: 14, marginBottom: 6, color: INK.primary },
  h3: { fontSize: 10.5, fontWeight: 600, marginTop: 8, marginBottom: 4 },
  muted: { color: INK.muted },
  small: { fontSize: 8 },
  bold: { fontWeight: 700 },
  row: { flexDirection: 'row' },
  kv: { flexDirection: 'row', marginBottom: 2 },
  kvKey: { width: 140, color: INK.muted },
  kvVal: { flex: 1 },
  table: { borderTopWidth: 0.75, borderTopColor: INK.rule, marginTop: 4 },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderBottomColor: INK.rule,
    paddingVertical: 3,
  },
  th: { fontWeight: 600, color: INK.muted, fontSize: 8.5 },
  td: { paddingHorizontal: 3 },
  num: { textAlign: 'right' },
  banner: { padding: 8, borderRadius: 3, marginVertical: 8, borderLeftWidth: 4 },
  bullet: { flexDirection: 'row', marginBottom: 2 },
  bulletDot: { width: 10 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
});

export function KeyValue({ k, v }: { k: string; v: ReactNode }) {
  return (
    <View style={s.kv} wrap={false}>
      <Text style={s.kvKey}>{k}</Text>
      <Text style={s.kvVal}>{v}</Text>
    </View>
  );
}

export function Bullets({ items }: { items: readonly string[] }) {
  return (
    <View>
      {items.map((item, i) => (
        <View key={i} style={s.bullet} wrap={false}>
          <Text style={s.bulletDot}>•</Text>
          <Text style={{ flex: 1 }}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

export type BannerTone = 'warning' | 'danger' | 'ok' | 'info';
export function Banner({
  tone,
  title,
  children,
}: {
  tone: BannerTone;
  title: string;
  children?: ReactNode;
}) {
  const colors =
    tone === 'danger'
      ? { backgroundColor: INK.dangerBg, color: INK.dangerFg, borderLeftColor: INK.dangerFg }
      : tone === 'warning'
        ? { backgroundColor: INK.warnBg, color: INK.warnFg, borderLeftColor: INK.warnFg }
        : tone === 'ok'
          ? { backgroundColor: INK.okBg, color: INK.okFg, borderLeftColor: INK.okFg }
          : { backgroundColor: INK.band, color: INK.text, borderLeftColor: INK.primary };
  return (
    <View style={[s.banner, colors]} wrap={false}>
      <Text style={s.bold}>{title}</Text>
      {children ? <Text>{children}</Text> : null}
    </View>
  );
}

export interface Column<Row> {
  header: string;
  width: number | string;
  align?: 'left' | 'right';
  cell: (row: Row) => string;
}

export function Table<Row>({
  columns,
  rows,
  rowKey,
}: {
  columns: Column<Row>[];
  rows: readonly Row[];
  rowKey: (r: Row, i: number) => string;
}) {
  return (
    <View style={s.table}>
      <View style={s.tr} fixed>
        {columns.map((c) => (
          <Text
            key={c.header}
            style={[s.td, s.th, { width: c.width }, c.align === 'right' ? s.num : {}]}
          >
            {c.header}
          </Text>
        ))}
      </View>
      {rows.map((r, i) => (
        <View key={rowKey(r, i)} style={s.tr} wrap={false}>
          {columns.map((c) => (
            <Text
              key={c.header}
              style={[s.td, { width: c.width }, c.align === 'right' ? s.num : {}]}
            >
              {c.cell(r)}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

export function TotalLine({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <View
      style={[s.totalRow, strong ? { borderTopWidth: 1, borderTopColor: INK.text } : {}]}
      wrap={false}
    >
      <Text style={strong ? s.bold : {}}>{label}</Text>
      <Text style={strong ? s.bold : {}}>{value}</Text>
    </View>
  );
}

/** Page with a running header (organization, document id, revision) and page x of y footer. */
export function DocPage({
  meta,
  title,
  children,
}: {
  meta: DocumentMeta;
  title: string;
  children: ReactNode;
}) {
  return (
    <Page size="LETTER" style={s.page}>
      <View style={s.header} fixed>
        <Text>{meta.organization.name}</Text>
        <Text>{`${title} · ${meta.documentId} · Rev ${meta.revision}`}</Text>
      </View>
      {children}
      <View style={s.footer} fixed>
        <Text>{`Issued ${formatDate(meta.issuedAt, meta.timeZone)}${meta.productName ? ` · Prepared with ${meta.productName}` : ''}`}</Text>
        <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </View>
    </Page>
  );
}
