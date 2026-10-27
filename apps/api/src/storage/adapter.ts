// StorageAdapter (PLT-018 R, BE-075): binaries live in encrypted object storage, never in Postgres
// and never in public buckets. Keys are tenant-prefixed (orgs/<orgId>/...), URLs are short-lived,
// and every API download is authorized per request before a URL is issued or bytes are streamed.

export interface SignedUpload {
  url: string;
  method: 'PUT';
  /** Headers the client must send with the PUT (content type, SSE). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface UploadUrlOptions {
  contentType: string;
  maxBytes: number;
  expiresInSeconds: number;
}

export interface DownloadUrlOptions {
  expiresInSeconds: number;
  contentType: string;
  /** Sent as Content-Disposition; sanitized by the adapter. */
  fileName?: string;
}

export interface StoredObjectInfo {
  sizeBytes: number;
}

export interface StorageAdapter {
  readonly driver: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  head(key: string): Promise<StoredObjectInfo | null>;
  delete(key: string): Promise<void>;
  createUploadUrl(key: string, options: UploadUrlOptions): Promise<SignedUpload>;
  createDownloadUrl(key: string, options: DownloadUrlOptions): Promise<string>;
}

const KEY_PATTERN = /^orgs\/[0-9a-f-]{36}\/[A-Za-z0-9/_.-]{1,400}$/;

/** Every object key starts with its tenant; no `..`, no absolute paths. */
export function assertObjectKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error('invalid object key');
  }
}

export function orgIdFromKey(key: string): string | null {
  const match = /^orgs\/([0-9a-f-]{36})\//.exec(key);
  return match?.[1] ?? null;
}

export function mediaObjectKey(orgId: string, assetId: string, variant: 'original' | 'sanitized' | 'thumbnail'): string {
  return `orgs/${orgId}/media/${assetId}/${variant}`;
}

export function safeFileName(name: string | undefined): string {
  const cleaned = (name ?? 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120);
  return cleaned || 'file';
}
