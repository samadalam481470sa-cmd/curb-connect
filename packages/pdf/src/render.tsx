import { renderToBuffer as reactPdfRenderToBuffer, type DocumentProps } from '@react-pdf/renderer';
import { createHash } from 'node:crypto';
import type { ReactElement } from 'react';
import { registerFonts } from './layout';
import type { AnySnapshot } from './snapshots';
import {
  CurbEstimateDocument,
  InvoiceDocument,
  ProposalDocument,
  SignatureCertificateDocument,
} from './templates/business';
import { RoofReportDocument } from './templates/roof-report';

/** Recorded with every generated document so a PDF can be traced to the template that made it. */
export const PDF_TEMPLATES_VERSION = '0.1.0';

/** Builds the react-pdf element tree for a snapshot. */
export function documentFor(snapshot: AnySnapshot): ReactElement<DocumentProps> {
  return buildDocument(snapshot) as ReactElement<DocumentProps>;
}

function buildDocument(snapshot: AnySnapshot): ReactElement {
  registerFonts();
  switch (snapshot.kind) {
    case 'roof_report':
      return <RoofReportDocument snapshot={snapshot} />;
    case 'curb_estimate':
      return <CurbEstimateDocument snapshot={snapshot} />;
    case 'proposal':
      return <ProposalDocument snapshot={snapshot} />;
    case 'invoice':
      return <InvoiceDocument snapshot={snapshot} />;
    case 'signature_certificate':
      return <SignatureCertificateDocument snapshot={snapshot} />;
  }
}

/** JSON with object keys sorted recursively, so equal snapshots always hash the same. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  );
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export interface RenderedPdf {
  buffer: Buffer;
  /** SHA-256 of the exact PDF bytes (store it: RF-036-R). */
  sha256: string;
  /** SHA-256 of the canonical snapshot + template version: identifies the content rendered. */
  contentChecksum: string;
  templateVersion: string;
  pageCount: number;
}

/** Counts page objects in an uncompressed-xref PDF as written by react-pdf (pdfkit). */
export function countPages(buffer: Buffer): number {
  return (buffer.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

/**
 * Renders a snapshot to PDF bytes. Output is deterministic for the same snapshot: fonts are
 * embedded from bundled files, ordering is stable, and the PDF creation/modification dates come
 * from `meta.issuedAt` rather than the clock.
 */
export async function renderToBuffer(snapshot: AnySnapshot): Promise<RenderedPdf> {
  const buffer = await reactPdfRenderToBuffer(documentFor(snapshot));
  return {
    buffer,
    sha256: sha256Hex(buffer),
    contentChecksum: sha256Hex(`${PDF_TEMPLATES_VERSION}\n${canonicalJson(snapshot)}`),
    templateVersion: PDF_TEMPLATES_VERSION,
    pageCount: countPages(buffer),
  };
}
