// Client for the services/vision worker (CV-044-API photo quality, CV-046-API curb recognition,
// AIQ-087 abstention). Only the API talks to the worker, with a service bearer token
// (VISION_SERVICE_TOKEN, never logged). The image bytes are sent as multipart (file + context) so
// the worker never needs storage access. A worker that is down or unconfigured surfaces as an
// explicit `dependency_unavailable` problem; it is never replaced by a fake score.
import { problem } from '../../http/problem';

export interface PhotoQualityReason {
  code: string;
  check: string;
  severity: 'warn' | 'fail';
  message: string;
  action: string;
}

export interface PhotoQualityResult {
  resultType: 'photo_quality';
  metricVersion: string;
  thresholdsVersion: string;
  verdict: 'usable' | 'usable_with_warnings' | 'retake_required';
  reasons: PhotoQualityReason[];
  checks: { duplicate?: { matches?: { id: string; match: string }[] }; blur?: { laplacianVariance?: number | null } } & Record<string, unknown>;
  exif: { gpsPresent: boolean } & Record<string, unknown>;
  hashes: { sha256: string; dhash: string; dhashAlgorithm: string };
}

export interface CurbRecognitionResult {
  resultType: 'abstain' | 'prediction';
  model: { modelId: string; version: string } | null;
  abstention: { reasonCode: string; message: string; route: 'manual_review' } | null;
  [k: string]: unknown;
}

export interface PhotoQualityRequest {
  bytes: Buffer;
  mimeType: string;
  photoId: string;
  viewType: string | null;
  compareHashes: { id: string; dhash: string; sha256?: string }[];
  rights: { analyze: boolean; source: string };
}

export interface RecognitionRequest {
  bytes: Buffer;
  mimeType: string;
  photoId: string;
  viewType: string | null;
  scaleReferenceId: string | null;
  rights: { analyze: boolean; source: string };
}

export interface VisionClient {
  photoQuality(input: PhotoQualityRequest): Promise<PhotoQualityResult>;
  recognizeCurb(input: RecognitionRequest): Promise<CurbRecognitionResult>;
}

export class HttpVisionClient implements VisionClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | undefined,
    private readonly timeoutMs = 15_000,
  ) {}

  private async post<T>(path: string, bytes: Buffer, mimeType: string, context: Record<string, unknown>): Promise<T> {
    if (!this.token) {
      throw problem('dependency_unavailable', 'The vision worker is not configured (VISION_SERVICE_TOKEN is missing); photo checks are unavailable.');
    }
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(bytes)], { type: mimeType }), 'photo');
    form.append('context', JSON.stringify(context));
    let res: Response;
    try {
      res = await fetch(new URL(path, this.baseUrl), {
        method: 'POST',
        headers: { authorization: `Bearer ${this.token}` },
        body: form,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw problem('dependency_unavailable', 'The vision worker could not be reached; retry shortly.', { retryable: true });
    }
    if (!res.ok) {
      const code = await res
        .json()
        .then((b: unknown) => (b as { code?: string }).code ?? 'error')
        .catch(() => 'error');
      throw problem('dependency_unavailable', `The vision worker refused the request (${res.status} ${code}).`, { retryable: res.status >= 500 });
    }
    return (await res.json()) as T;
  }

  photoQuality(i: PhotoQualityRequest): Promise<PhotoQualityResult> {
    return this.post('/v1/photo-quality', i.bytes, i.mimeType, {
      photoId: i.photoId,
      viewType: i.viewType,
      compareHashes: i.compareHashes,
      rights: i.rights,
    });
  }

  recognizeCurb(i: RecognitionRequest): Promise<CurbRecognitionResult> {
    return this.post('/v1/curb/recognize', i.bytes, i.mimeType, {
      photoId: i.photoId,
      viewType: i.viewType,
      scaleReferenceId: i.scaleReferenceId,
      rights: i.rights,
    });
  }
}

let override: VisionClient | null = null;

/** Test seam: replaces the worker client (null restores the HTTP client). */
export function setVisionClient(client: VisionClient | null): void {
  override = client;
}

export function visionClient(baseUrl: string): VisionClient {
  // Reads the token from the environment (not src/config.ts, which this module does not own).
  return override ?? new HttpVisionClient(baseUrl, process.env.VISION_SERVICE_TOKEN || undefined);
}
