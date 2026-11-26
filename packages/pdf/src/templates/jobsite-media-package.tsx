import { Document, Image, Link, StyleSheet, Text, View } from '@react-pdf/renderer';
import { DocPage, KeyValue, Table, s } from '../layout';
import type { JobsiteMediaPackageSnapshot } from '../snapshots';

const title = 'Project media package';
const styles = StyleSheet.create({
  thumbnail: { width: '100%', height: 345, objectFit: 'contain', marginTop: 12, marginBottom: 12 },
  index: { marginTop: 10 },
  checksum: { fontSize: 7, color: '#4a5660' },
});

export function JobsiteMediaPackageDocument({
  snapshot,
}: {
  snapshot: JobsiteMediaPackageSnapshot;
}) {
  const { meta, projectName, files } = snapshot;
  return (
    <Document
      title={title + ' ' + meta.documentId}
      author={meta.organization.name}
      creator={meta.productName ?? 'Field Pro'}
      producer={meta.productName ?? 'Field Pro'}
      language={meta.locale ?? 'en-US'}
      creationDate={new Date(meta.issuedAt)}
      modificationDate={new Date(meta.issuedAt)}
    >
      <DocPage meta={meta} title={title}>
        <Text style={s.h1}>{title}</Text>
        <KeyValue k="Project" v={projectName} />
        <KeyValue k="Package" v={meta.documentId} />
        <KeyValue k="Generated" v={meta.issuedAt} />
        <View style={styles.index}>
          <Table
            columns={[
              { header: 'File', width: '48%', cell: (file) => file.name },
              { header: 'Source', width: '18%', cell: (file) => file.source },
              { header: 'Capture time (UTC)', width: '34%', cell: (file) => file.capturedAt },
            ]}
            rows={files}
            rowKey={(file) => file.mediaId}
          />
        </View>
      </DocPage>
      {files.map((file) => (
        <DocPage key={file.mediaId} meta={meta} title={title}>
          <Text style={s.h1}>{file.name}</Text>
          <KeyValue k="Media ID" v={file.mediaId} />
          <KeyValue k="Captured" v={file.capturedAt} />
          <KeyValue k="Source" v={file.source} />
          {file.revisionId && <KeyValue k="Revision ID" v={file.revisionId} />}
          <KeyValue k="Format" v={file.mimeType} />
          <Text style={styles.checksum}>{'SHA-256 ' + file.sha256}</Text>
          {file.thumbnail && <Image src={file.thumbnail} style={styles.thumbnail} />}
          <Link src={file.href}>Open the media in the project</Link>
        </DocPage>
      ))}
    </Document>
  );
}
