// LocalEncryptedStorage: development/test object store. Each object is one file under the storage
// root, encrypted with AES-256-GCM. The object key is bound as additional authenticated data, so
// a file copied to another key (or another tenant's prefix) fails to decrypt. URLs point at the
// API's own /v1/storage routes and carry an HMAC-signed, short-lived capability token.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import {
  assertObjectKey,
  type DownloadUrlOptions,
  safeFileName,
  type SignedUpload,
  type StorageAdapter,
  type StoredObjectInfo,
  type UploadUrlOptions,
} from './adapter';
import { createStorageToken } from './signing';

const MAGIC = Buffer.from('FLE1');
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + IV_BYTES + TAG_BYTES;

export interface LocalEncryptedStorageOptions {
  root: string;
  /** 32-byte AES key. */
  key: Buffer;
  /** Secret for signing URL tokens. */
  signingSecret: string;
  /** e.g. http://localhost:4000 */
  publicOrigin: string;
}

export class LocalEncryptedStorage implements StorageAdapter {
  readonly driver = 'local' as const;
  private readonly root: string;

  constructor(private readonly options: LocalEncryptedStorageOptions) {
    if (options.key.length !== 32) throw new Error('LocalEncryptedStorage needs a 32-byte key');
    this.root = resolve(options.root);
  }

  private pathFor(key: string): string {
    assertObjectKey(key);
    const path = resolve(join(this.root, ...key.split('/')));
    if (!path.startsWith(this.root + sep)) throw new Error('object key escapes the storage root');
    return `${path}.enc`;
  }

  encrypt(key: string, plain: Buffer): Buffer {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.options.key, iv);
    cipher.setAAD(Buffer.from(key, 'utf8'));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
  }

  decrypt(key: string, stored: Buffer): Buffer {
    if (stored.length < HEADER_BYTES || !stored.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('not a Fieldline encrypted object');
    }
    const iv = stored.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
    const tag = stored.subarray(MAGIC.length + IV_BYTES, HEADER_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.options.key, iv);
    decipher.setAAD(Buffer.from(key, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(stored.subarray(HEADER_BYTES)), decipher.final()]);
  }

  async put(key: string, body: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temp, this.encrypt(key, body));
    await rename(temp, path);
  }

  async get(key: string): Promise<Buffer> {
    return this.decrypt(key, await readFile(this.pathFor(key)));
  }

  async head(key: string): Promise<StoredObjectInfo | null> {
    try {
      const info = await stat(this.pathFor(key));
      return { sizeBytes: Math.max(0, info.size - HEADER_BYTES) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async createUploadUrl(key: string, options: UploadUrlOptions): Promise<SignedUpload> {
    assertObjectKey(key);
    const exp = Math.floor(Date.now() / 1000) + options.expiresInSeconds;
    const token = createStorageToken(this.options.signingSecret, {
      op: 'upload',
      key,
      exp,
      contentType: options.contentType,
      maxBytes: options.maxBytes,
    });
    return {
      url: `${this.options.publicOrigin}/v1/storage/upload/${token}`,
      method: 'PUT',
      headers: { 'content-type': options.contentType },
      expiresAt: new Date(exp * 1000),
    };
  }

  async createDownloadUrl(key: string, options: DownloadUrlOptions): Promise<string> {
    assertObjectKey(key);
    const token = createStorageToken(this.options.signingSecret, {
      op: 'download',
      key,
      exp: Math.floor(Date.now() / 1000) + options.expiresInSeconds,
      contentType: options.contentType,
      ...(options.fileName && { fileName: safeFileName(options.fileName) }),
    });
    return `${this.options.publicOrigin}/v1/storage/object/${token}`;
  }
}
