// Invoice Intelligence intake: checks each uploaded file before anything reads it, opens ZIP
// archives with strict limits, and turns CSV, TSV and Excel files into rows. PDFs give their
// embedded text. Nothing here trusts a file name or a declared content type.
import { createHash } from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';

export type FileKind = 'csv' | 'xlsx' | 'pdf' | 'image' | 'zip' | 'unsupported';

export const LIMITS = {
  /** One uploaded file (base64 decoded). */
  fileBytes: 12 * 1024 * 1024,
  /** Files in one batch, counting files inside archives. */
  batchFiles: 500,
  /** Entries in one ZIP. */
  zipEntries: 400,
  /** Uncompressed bytes in one ZIP. */
  zipBytes: 150 * 1024 * 1024,
  /** Uncompressed size / compressed size above this is treated as a ZIP bomb. */
  zipRatio: 200,
  /** Rows read from one spreadsheet. */
  rows: 20_000,
  /** Columns read from one spreadsheet. */
  columns: 120,
} as const;

export const SUPPORTED_FORMATS = [
  'CSV and TSV exports (QuickBooks, Xero, FreshBooks, Wave, Zoho, Jobber, ServiceTitan, Stripe, Square and others)',
  'Excel workbooks (.xlsx) — first sheet',
  'PDF invoices with selectable text',
  'Scanned PDFs and photos (PNG, JPEG, WebP) — read by AI when the server AI is turned on, otherwise entered by hand in review',
  'ZIP archives of any of the above (no nested ZIPs, no passwords)',
];

export const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const startsWith = (b: Uint8Array, sig: number[]) => sig.every((v, i) => b[i] === v);

/** Decide what a file really is from its bytes, using the name only to tell CSV from text. */
export function sniffKind(name: string, bytes: Uint8Array): FileKind {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) || startsWith(bytes, [0xff, 0xd8, 0xff]))
    return 'image';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && strFromU8(bytes.subarray(8, 12)) === 'WEBP')
    return 'image';
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return /\.xlsx$/i.test(name) ? 'xlsx' : 'zip';
  if (/\.(csv|tsv|txt)$/i.test(name) && looksLikeText(bytes)) return 'csv';
  return 'unsupported';
}

function looksLikeText(bytes: Uint8Array): boolean {
  const n = Math.min(bytes.length, 8192);
  for (let i = 0; i < n; i += 1) if (bytes[i] === 0) return false;
  return true;
}

/** Content that is never accepted, whatever its extension. */
export function dangerousContent(name: string, bytes: Uint8Array): string | null {
  if (
    /\.(exe|dll|bat|cmd|com|scr|ps1|vbs|js|jar|msi|sh|app|xlsm|xlsb|docm|pptm|html?|svg)$/i.test(
      name,
    )
  )
    return 'This file type is not accepted.';
  if (startsWith(bytes, [0x4d, 0x5a])) return 'Executable files are not accepted.';
  if (startsWith(bytes, [0x7f, 0x45, 0x4c, 0x46])) return 'Executable files are not accepted.';
  if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0]))
    return 'Old Office files (.xls/.doc) can hold macros; save as .xlsx or CSV.';
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) {
    const head = strFromU8(bytes.subarray(0, Math.min(bytes.length, 4_000_000)), true);
    if (/\/Encrypt\b/.test(head))
      return 'Password-protected PDFs cannot be read. Remove the password and upload again.';
    if (/\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(head))
      return 'This PDF contains scripts or embedded files and was held back.';
  }
  return null;
}

export interface ExpandedFile {
  name: string;
  bytes: Uint8Array;
}

/** Open a ZIP with entry, size, ratio, path and nesting limits. */
export function expandZip(bytes: Uint8Array): {
  files: ExpandedFile[];
  skipped: { name: string; reason: string }[];
} {
  const skipped: { name: string; reason: string }[] = [];
  let entries = 0;
  let total = 0;
  const out = unzipSync(bytes, {
    filter: (f) => {
      entries += 1;
      const name = f.name;
      if (entries > LIMITS.zipEntries) {
        skipped.push({ name, reason: `More than ${LIMITS.zipEntries} files in the archive.` });
        return false;
      }
      if (name.endsWith('/') || /(^|\/)(__MACOSX|\.DS_Store)/.test(name)) return false;
      if (name.startsWith('/') || name.includes('..') || name.includes('\\')) {
        skipped.push({ name, reason: 'Unsafe path inside the archive.' });
        return false;
      }
      if (f.originalSize > LIMITS.fileBytes) {
        skipped.push({ name, reason: 'File inside the archive is larger than 12 MB.' });
        return false;
      }
      if (f.size > 0 && f.originalSize / f.size > LIMITS.zipRatio) {
        skipped.push({ name, reason: 'Compression ratio is too high (possible ZIP bomb).' });
        return false;
      }
      total += f.originalSize;
      if (total > LIMITS.zipBytes) {
        skipped.push({ name, reason: 'Archive is larger than 150 MB uncompressed.' });
        return false;
      }
      return true;
    },
  });
  const files: ExpandedFile[] = [];
  for (const [name, data] of Object.entries(out)) {
    if (
      /\.zip$/i.test(name) ||
      (startsWith(data, [0x50, 0x4b, 0x03, 0x04]) && !/\.xlsx$/i.test(name))
    ) {
      skipped.push({ name, reason: 'Archives inside archives are not opened.' });
      continue;
    }
    files.push({ name: name.split('/').pop() || name, bytes: data });
  }
  return { files, skipped };
}

/** RFC 4180 CSV (or TSV) parser: quotes, doubled quotes, CR/LF, BOM. */
export function parseDelimited(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.indexOf('\n') >= 0 ? src.indexOf('\n') : src.length);
  const counts = { ',': 0, '\t': 0, ';': 0 } as Record<string, number>;
  for (const ch of firstLine) if (ch in counts) counts[ch]! += 1;
  const delim =
    Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![1] > 0
      ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0]![0]
      : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row.slice(0, LIMITS.columns));
      row = [];
      if (rows.length > LIMITS.rows) break;
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '') && rows.length <= LIMITS.rows)
    rows.push(row.slice(0, LIMITS.columns));
  return rows;
}

const xmlText = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');

function colIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Excel serial date (1900 system) to ISO date. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 20000 || serial > 80000) return null;
  const ms = Math.round((serial - 25569) * 86_400_000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** First worksheet of an .xlsx as rows of text. Date-formatted cells are not detected by style;
 *  serial numbers in date columns are converted later by the date parser. */
export function parseXlsx(bytes: Uint8Array): string[][] {
  const files = unzipSync(bytes, {
    filter: (f) =>
      /^xl\/(sharedStrings\.xml|workbook\.xml|worksheets\/sheet\d+\.xml|_rels\/workbook\.xml\.rels)$/.test(
        f.name,
      ) && f.originalSize < 80 * 1024 * 1024,
  });
  if (Object.keys(files).some((n) => /vbaProject/.test(n)))
    throw new Error('Workbook contains macros.');
  const shared: string[] = [];
  const ss = files['xl/sharedStrings.xml'];
  if (ss) {
    for (const m of strFromU8(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      shared.push(
        [...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => xmlText(t[1]!)).join(''),
      );
    }
  }
  const sheetName = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))[0];
  if (!sheetName) throw new Error('The workbook has no sheets.');
  const xml = strFromU8(files[sheetName]!);
  const rows: string[][] = [];
  for (const r of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row: string[] = [];
    for (const c of r[1]!.matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1]!;
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? '';
      const type = /t="(\w+)"/.exec(attrs)?.[1] ?? 'n';
      const body = c[2] ?? '';
      let value: string;
      if (type === 's') value = shared[Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? -1)] ?? '';
      else if (type === 'inlineStr') value = xmlText(/<is>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else value = xmlText(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '');
      const idx = ref ? colIndex(ref) : row.length;
      if (idx >= LIMITS.columns) continue;
      while (row.length < idx) row.push('');
      row[idx] = value;
    }
    if (row.some((v) => v.trim() !== '')) rows.push(row);
    if (rows.length > LIMITS.rows) break;
  }
  return rows;
}

/** Header row: the first row within the first 15 that looks like column names. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 15); i += 1) {
    const cells = rows[i]!.filter((c) => c.trim());
    const texty = cells.filter((c) => /[a-z]/i.test(c) && !/^\$?[\d,.-]+$/.test(c.trim()));
    if (cells.length >= 2 && texty.length >= Math.max(2, cells.length * 0.6)) return i;
  }
  return 0;
}
