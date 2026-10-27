import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from '../config';
import type { StorageAdapter } from './adapter';
import { LocalEncryptedStorage } from './local';
import { S3Storage } from './s3';

export * from './adapter';
export { LocalEncryptedStorage } from './local';
export { S3Storage } from './s3';

/** apps/api: the nearest ancestor with a package.json (works from src/storage and from dist/). */
export function packageRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 5; depth += 1) {
    if (existsSync(join(dir, 'package.json'))) return dir;
    dir = dirname(dir);
  }
  return process.cwd();
}

export function storageSigningSecret(config: AppConfig): string {
  return `${config.session.secret}:storage`;
}

/**
 * Builds the configured adapter. Local storage refuses to run without a key outside tests (a
 * random per-process key in tests keeps fixtures unreadable after the run).
 */
export function createStorage(config: AppConfig): StorageAdapter {
  if (config.storage.driver === 's3') {
    const s3 = config.storage.s3;
    return new S3Storage({
      bucket: s3.bucket as string,
      region: s3.region as string,
      ...(s3.endpoint && { endpoint: s3.endpoint }),
      ...(s3.accessKeyId && { accessKeyId: s3.accessKeyId }),
      ...(s3.secretAccessKey && { secretAccessKey: s3.secretAccessKey }),
      forcePathStyle: s3.forcePathStyle,
    });
  }
  let key: Buffer;
  if (config.storage.encryptionKey) {
    key = Buffer.from(config.storage.encryptionKey, 'base64');
  } else if (config.env === 'test') {
    key = randomBytes(32);
  } else {
    throw new Error('STORAGE_ENCRYPTION_KEY is required for STORAGE_DRIVER=local outside tests.');
  }
  const root = isAbsolute(config.storage.localDir)
    ? config.storage.localDir
    : resolve(packageRoot(), config.storage.localDir);
  return new LocalEncryptedStorage({
    root,
    key,
    signingSecret: storageSigningSecret(config),
    publicOrigin: config.apiOrigin,
  });
}
