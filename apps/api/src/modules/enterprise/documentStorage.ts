import { createHash } from 'node:crypto';
import { problem } from '../../http/problem';
import { orgIdFromKey, type StorageAdapter } from '../../storage';

export async function readVerifiedEnterpriseDocument(
  storage: StorageAdapter,
  orgId: string,
  version: { storageKey: string; byteSize: number; sha256Hex: string },
) {
  if (orgIdFromKey(version.storageKey) !== orgId) throw problem('not_found');
  const object = await storage.head(version.storageKey);
  if (!object) throw problem('not_found', 'The stored file is unavailable.');
  if (object.sizeBytes !== version.byteSize)
    throw problem('conflict', 'The stored file size differs from its version record.');
  const bytes = await storage.get(version.storageKey);
  if (
    bytes.length !== version.byteSize ||
    createHash('sha256').update(bytes).digest('hex') !== version.sha256Hex
  )
    throw problem('conflict', 'The stored file does not match its recorded checksum.');
  return bytes;
}
