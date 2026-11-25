// Reads the text layer of an uploaded plan PDF (room labels, areas, dimension strings) so a plan
// exported from CAD can be read without any AI service. Scanned or photographed sheets have no text
// layer and return an empty string; the caller then explains that reading pictures needs AI.
//
// Safety: pdf.js 6.2.108+ is required (earlier versions could run JavaScript from a malicious PDF,
// GHSA-hq66-cqwq-w95j; 6.x has no eval path at all). No font loading and no network; at most
// MAX_PAGES pages are read, and the whole read is bounded by a timeout. The file size limit is
// enforced by the route before this runs.

import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { EnterpriseTakeoffSheet } from '@fieldline/contracts';
import type { z } from 'zod';

const MAX_PAGES = 12;
const MAX_CHARS = 60_000;

export interface PlanPdfText {
  text: string;
  pages: number;
}

export async function extractPlanPdfText(
  data: Uint8Array,
  timeoutMs = 10_000,
): Promise<PlanPdfText> {
  return withPlanDocument(data, timeoutMs, false, readPages);
}

export async function withPlanDocument<T>(
  data: Uint8Array,
  timeoutMs: number,
  stopAtErrors: boolean,
  read: (document: PDFDocumentProxy) => Promise<T>,
): Promise<T> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data,
    disableFontFace: true,
    useSystemFonts: false,
    disableAutoFetch: true,
    disableStream: true,
    stopAtErrors,
    verbosity: 0,
  });
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('plan pdf read timed out')), timeoutMs);
  });
  try {
    return await Promise.race([task.promise.then(read), timeout]);
  } finally {
    clearTimeout(timer);
    await task.destroy().catch(() => undefined);
  }
}

async function readPages(doc: PDFDocumentProxy): Promise<PlanPdfText> {
  const pages = Math.min(doc.numPages, MAX_PAGES);
  const parts: string[] = [];
  let length = 0;
  for (let n = 1; n <= pages && length < MAX_CHARS; n += 1) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    for (const item of content.items) {
      const str = (item as { str?: unknown }).str;
      if (typeof str !== 'string' || str.length === 0) continue;
      parts.push(str);
      length += str.length + 1;
    }
    parts.push('\n');
    page.cleanup();
  }
  return { text: parts.join(' ').slice(0, MAX_CHARS), pages };
}

/** A text layer worth reading has real words, not just a few stray marks. */
export function hasReadableText(text: string): boolean {
  return (text.match(/[A-Za-z]{3,}/g) ?? []).length >= 8;
}

type PlanSheetMetadata = Pick<
  z.infer<typeof EnterpriseTakeoffSheet>,
  'pageNumber' | 'pageLabel' | 'widthPoints' | 'heightPoints' | 'rotation'
>;

export class PlanSheetLimitError extends Error {}

export async function readPlanPdfSheets(
  data: Uint8Array,
  remainingSheets: number,
  timeoutMs = 8000,
): Promise<PlanSheetMetadata[]> {
  return withPlanDocument(data, timeoutMs, true, async (doc) => {
    if (doc.numPages > remainingSheets)
      throw new PlanSheetLimitError('The plan set has too many pages.');
    if (doc.numPages < 1) throw new Error('The PDF has no readable sheets.');
    const labels = await doc.getPageLabels();
    const sheets: PlanSheetMetadata[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const { width, height } = page.getViewport({ scale: 1, rotation: 0 });
      const rotation = ((page.rotate % 360) + 360) % 360;
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0)
        throw new Error('A PDF sheet has invalid dimensions.');
      if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270)
        throw new Error('A PDF sheet has invalid rotation.');
      const rawLabel = (labels?.[pageNumber - 1] ?? '').slice(0, 120);
      const pageLabel = Array.from(rawLabel, (character) =>
        character.charCodeAt(0) < 32 ? ' ' : character,
      )
        .join('')
        .trim();
      sheets.push({
        pageNumber,
        pageLabel: pageLabel || String(pageNumber),
        widthPoints: width,
        heightPoints: height,
        rotation,
      });
      page.cleanup();
    }
    return sheets;
  });
}
