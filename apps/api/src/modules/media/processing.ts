// Upload completion pipeline (PLT-018 R, BE-075, LCH-091 A "malicious uploads"):
//   size limit -> MIME sniffing (file-type, never the client's claim) -> SHA-256 vs declared ->
//   EXIF into a restricted field -> sanitized copy without metadata + thumbnail (sharp) ->
//   malware scan adapter (dev: records `not_scanned` honestly).
import { createHash } from 'node:crypto';
import exifr from 'exifr';
import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';
import type { MediaScanStatus } from '@fieldline/contracts';

export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
  'application/pdf',
  'video/mp4',
] as const;
export type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];
const IMAGE_TYPES = new Set<string>(['image/jpeg', 'image/png', 'image/heic', 'image/webp']);
/** Decompression-bomb guard for sharp (pixels). */
const MAX_INPUT_PIXELS = 100_000_000;
export const THUMBNAIL_PX = 320;

export interface MalwareScanner {
  readonly name: string;
  scan(bytes: Buffer): Promise<MediaScanStatus>;
}

/** No scanner in development: the asset says `not_scanned`, never `clean`. */
export class NoopScanner implements MalwareScanner {
  readonly name = 'noop';
  async scan(): Promise<MediaScanStatus> {
    return 'not_scanned';
  }
}

export type ProcessingRejection =
  | { reason: 'too_large'; detail: string }
  | { reason: 'unsupported_type'; detail: string }
  | { reason: 'type_mismatch'; detail: string }
  | { reason: 'checksum_mismatch'; detail: string }
  | { reason: 'undecodable'; detail: string };

export interface RestrictedExif {
  gps: { latitude: number; longitude: number; altitude: number | null } | null;
  make: string | null;
  model: string | null;
  orientation: number | null;
  capturedAt: string | null;
}

export interface ProcessedMedia {
  mimeType: AllowedMime;
  sizeBytes: number;
  sha256: string;
  widthPx: number | null;
  heightPx: number | null;
  capturedAt: Date | null;
  exif: RestrictedExif | null;
  sanitized: { bytes: Buffer; mimeType: string } | null;
  thumbnail: { bytes: Buffer; mimeType: string } | null;
  scanStatus: MediaScanStatus;
}

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function extractExif(bytes: Buffer): Promise<RestrictedExif | null> {
  try {
    const data = (await exifr.parse(bytes, { gps: true, tiff: true, exif: true, translateValues: false })) as
      | Record<string, unknown>
      | undefined;
    if (!data) return null;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 120) : null);
    const lat = num(data.latitude);
    const lon = num(data.longitude);
    const taken = data.DateTimeOriginal ?? data.CreateDate;
    return {
      gps: lat !== null && lon !== null ? { latitude: lat, longitude: lon, altitude: num(data.GPSAltitude) } : null,
      make: str(data.Make),
      model: str(data.Model),
      orientation: num(data.Orientation),
      capturedAt: taken instanceof Date && !Number.isNaN(taken.getTime()) ? taken.toISOString() : null,
    };
  } catch {
    return null;
  }
}

export async function processUpload(
  bytes: Buffer,
  declared: { mimeType: string; sha256: string; maxBytes: number },
  scanner: MalwareScanner,
): Promise<{ ok: true; media: ProcessedMedia } | { ok: false; rejection: ProcessingRejection }> {
  if (bytes.length === 0 || bytes.length > declared.maxBytes) {
    return {
      ok: false,
      rejection: { reason: 'too_large', detail: `The file is ${bytes.length} bytes; the limit for this upload is ${declared.maxBytes}.` },
    };
  }
  const sniffed = await fileTypeFromBuffer(bytes);
  const mime = sniffed?.mime;
  if (!mime || !(ALLOWED_MIME_TYPES as readonly string[]).includes(mime)) {
    return { ok: false, rejection: { reason: 'unsupported_type', detail: 'The file content is not a supported photo, video or PDF.' } };
  }
  if (mime !== declared.mimeType) {
    return {
      ok: false,
      rejection: { reason: 'type_mismatch', detail: `The file content is ${mime}, not the declared ${declared.mimeType}.` },
    };
  }
  const sha256 = sha256Hex(bytes);
  if (sha256 !== declared.sha256) {
    return { ok: false, rejection: { reason: 'checksum_mismatch', detail: 'The uploaded bytes do not match the declared SHA-256.' } };
  }

  let widthPx: number | null = null;
  let heightPx: number | null = null;
  let exif: RestrictedExif | null = null;
  let sanitized: ProcessedMedia['sanitized'] = null;
  let thumbnail: ProcessedMedia['thumbnail'] = null;

  if (IMAGE_TYPES.has(mime)) {
    exif = await extractExif(bytes);
    try {
      const image = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
      const meta = await image.metadata();
      // Apply EXIF orientation, then re-encode. sharp writes no metadata unless asked, so the
      // sanitized copy carries no GPS, device or timestamp tags (PLT-018 D).
      const oriented = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate();
      const outFormat = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpeg';
      const sanitizedBytes =
        outFormat === 'png'
          ? await oriented.png().toBuffer()
          : outFormat === 'webp'
            ? await oriented.webp({ quality: 90 }).toBuffer()
            : await oriented.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
      sanitized = { bytes: sanitizedBytes, mimeType: `image/${outFormat}` };
      thumbnail = {
        bytes: await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
          .rotate()
          .resize(THUMBNAIL_PX, THUMBNAIL_PX, { fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 70 })
          .toBuffer(),
        mimeType: 'image/webp',
      };
      const swap = (meta.orientation ?? 1) >= 5;
      widthPx = (swap ? meta.height : meta.width) ?? null;
      heightPx = (swap ? meta.width : meta.height) ?? null;
    } catch {
      return {
        ok: false,
        rejection: {
          reason: 'undecodable',
          detail:
            mime === 'image/heic'
              ? 'This HEIC photo could not be processed here. Set the camera to "Most compatible" (JPEG) and retake it.'
              : 'The image could not be decoded.',
        },
      };
    }
  }

  return {
    ok: true,
    media: {
      mimeType: mime as AllowedMime,
      sizeBytes: bytes.length,
      sha256,
      widthPx,
      heightPx,
      capturedAt: exif?.capturedAt ? new Date(exif.capturedAt) : null,
      exif,
      sanitized,
      thumbnail,
      scanStatus: await scanner.scan(bytes),
    },
  };
}
