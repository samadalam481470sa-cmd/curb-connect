import { Document, Text, View } from '@react-pdf/renderer';
import { Banner, Bullets, DocPage, INK, s } from '../layout';
import type { PitchDeckSnapshot } from '../snapshots';

/**
 * The outreach pitch-deck outline as a draft slide sheet: one slide per page, in the order
 * the permit search built them. Every point comes from the permit as published — the sheet
 * says so on its face, and nothing here is sent anywhere by Field Pro.
 */
export function PitchDeckDocument({ snapshot }: { snapshot: PitchDeckSnapshot }) {
  const { meta } = snapshot;
  const company = meta.organization.name;
  const title = company ? `${company} — pitch deck (draft)` : 'Pitch deck (draft)';
  return (
    <Document
      title={`${title} ${meta.documentId}`}
      author={meta.organization.name}
      creator={meta.productName ?? 'Field Pro'}
      producer={meta.productName ?? 'Field Pro'}
      language={meta.locale ?? 'en-US'}
      creationDate={new Date(meta.issuedAt)}
      modificationDate={new Date(meta.issuedAt)}
    >
      {snapshot.slides.map((slide, i) => (
        <DocPage key={i} meta={meta} title={title}>
          <Banner tone="info" title="DRAFT — review before sending" />
          {snapshot.leadTitle ? <Text style={s.muted}>{snapshot.leadTitle}</Text> : null}
          <View style={{ marginTop: 18 }}>
            <Text style={{ fontSize: 20, fontWeight: 700, color: INK.text }}>{slide.title}</Text>
            <View style={{ marginTop: 14 }}>
              <Bullets items={slide.points} />
            </View>
          </View>
          <Text style={[s.muted, { marginTop: 28 }]}>
            {`Slide ${i + 1} of ${snapshot.slides.length}`}
          </Text>
          {i === snapshot.slides.length - 1 &&
            snapshot.disclaimers.map((d, j) => (
              <Text key={j} style={[s.muted, { marginTop: 10 }]}>
                {d}
              </Text>
            ))}
        </DocPage>
      ))}
    </Document>
  );
}
