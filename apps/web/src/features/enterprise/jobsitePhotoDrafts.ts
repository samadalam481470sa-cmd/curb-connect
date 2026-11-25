import { JobsitePhotoMime } from '@fieldline/contracts';
import { createStore, delMany, get, getMany, keys, setMany, update } from 'idb-keyval';
import { z } from 'zod';
import { indexedDbAvailable, OFFLINE_DB_NAME } from '../../lib/offline/store';
import type { JobsitePhotoDraft } from './jobsitePhotoUpload';

export type JobsiteDraftScope = { orgId: string; userId: string; projectId: string };

const Metadata = z.strictObject({
  id: z.uuid(),
  finalizeRequestId: z.uuid(),
  filename: z.string().min(1).max(120),
  mimeType: JobsitePhotoMime,
  byteSize: z.number().int().positive(),
  lastModified: z.number().int().nonnegative(),
  capturedAt: z.iso.datetime({ offset: true }),
});
export type JobsiteDraftMetadata = z.infer<typeof Metadata>;

type EncryptedValue = {
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
};

const records = createStore(OFFLINE_DB_NAME + '-jobsite-photos', 'drafts');
const deviceKeys = createStore(OFFLINE_DB_NAME + '-jobsite-photo-keys', 'keys');

function scopePrefix(scope: JobsiteDraftScope) {
  return scope.orgId + '/' + scope.userId + '/' + scope.projectId + '/';
}

function keyId(scope: JobsiteDraftScope) {
  return scope.orgId + '/' + scope.userId;
}

function requireDeviceStorage() {
  if (!indexedDbAvailable() || !globalThis.crypto?.subtle)
    throw new Error('Encrypted device storage is unavailable.');
}

async function currentKey(scope: JobsiteDraftScope) {
  const found = await get<CryptoKey>(keyId(scope), deviceKeys);
  if (!found) throw new Error('The device key for these photos is unavailable.');
  return found;
}

async function getOrCreateKey(scope: JobsiteDraftScope) {
  const id = keyId(scope);
  const existing = await get<CryptoKey>(id, deviceKeys);
  if (existing) return existing;
  const generated = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  await update<CryptoKey>(id, (current) => current ?? generated, deviceKeys);
  return currentKey(scope);
}

function parameters(entry: string, iv: Uint8Array<ArrayBuffer>) {
  const additionalData = new TextEncoder().encode('fieldpro-jobsite-photo-v1:' + entry);
  return { name: 'AES-GCM', iv, additionalData };
}

async function seal(key: CryptoKey, entry: string, bytes: ArrayBuffer | Uint8Array<ArrayBuffer>) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv, ciphertext: await crypto.subtle.encrypt(parameters(entry, iv), key, bytes) };
}

function open(key: CryptoKey, entry: string, record: EncryptedValue) {
  return crypto.subtle.decrypt(parameters(entry, record.iv), key, record.ciphertext);
}

function parseMetadata(bytes: ArrayBuffer) {
  return Metadata.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

export async function saveJobsitePhotoDraft(scope: JobsiteDraftScope, draft: JobsitePhotoDraft) {
  requireDeviceStorage();
  const metadata = Metadata.parse({
    id: draft.localCaptureId,
    finalizeRequestId: draft.finalizeRequestId,
    filename: draft.file.name,
    mimeType: draft.file.type,
    byteSize: draft.file.size,
    lastModified: draft.file.lastModified,
    capturedAt: draft.capturedAt,
  });
  const prefix = scopePrefix(scope) + metadata.id;
  const key = await getOrCreateKey(scope);
  const [details, file] = await Promise.all([
    seal(key, prefix + '/details', new TextEncoder().encode(JSON.stringify(metadata))),
    seal(key, prefix + '/file', await draft.file.arrayBuffer()),
  ]);
  await setMany(
    [
      [prefix + '/details', details],
      [prefix + '/file', file],
    ],
    records,
  );
  return metadata;
}

export async function listJobsitePhotoDrafts(scope: JobsiteDraftScope) {
  requireDeviceStorage();
  const prefix = scopePrefix(scope);
  const entries = (await keys<string>(records)).filter(
    (key) => key.startsWith(prefix) && key.endsWith('/details'),
  );
  if (!entries.length) return { drafts: [], unavailable: 0 };
  const key = await currentKey(scope);
  const values = await getMany<EncryptedValue>(entries, records);
  const drafts: JobsiteDraftMetadata[] = [];
  let unavailable = 0;
  for (const [index, entry] of entries.entries()) {
    const value = values[index];
    if (!value) continue; // A different tab may have uploaded this photo.
    try {
      const metadata = parseMetadata(await open(key, entry, value));
      if (entry !== prefix + metadata.id + '/details') throw new Error('Capture ID changed.');
      drafts.push(metadata);
    } catch {
      unavailable++;
    }
  }
  return { drafts: drafts.sort((a, b) => b.capturedAt.localeCompare(a.capturedAt)), unavailable };
}

export async function readJobsitePhotoDraft(
  scope: JobsiteDraftScope,
  id: string,
): Promise<JobsitePhotoDraft> {
  requireDeviceStorage();
  const prefix = scopePrefix(scope) + z.uuid().parse(id);
  const detailsKey = prefix + '/details';
  const fileKey = prefix + '/file';
  const [details, photo] = await getMany<EncryptedValue>([detailsKey, fileKey], records);
  if (!details || !photo) throw new Error('This photo is no longer queued on this device.');
  const key = await currentKey(scope);
  const [rawMetadata, bytes] = await Promise.all([
    open(key, detailsKey, details),
    open(key, fileKey, photo),
  ]);
  const metadata = parseMetadata(rawMetadata);
  if (metadata.id !== id || bytes.byteLength !== metadata.byteSize)
    throw new Error('The saved photo could not be verified.');
  return {
    localCaptureId: id,
    finalizeRequestId: metadata.finalizeRequestId,
    capturedAt: metadata.capturedAt,
    file: new File([bytes], metadata.filename, {
      type: metadata.mimeType,
      lastModified: metadata.lastModified,
    }),
  };
}

export async function removeUploadedJobsiteDraft(scope: JobsiteDraftScope, id: string) {
  requireDeviceStorage();
  const prefix = scopePrefix(scope) + z.uuid().parse(id);
  await delMany([prefix + '/details', prefix + '/file'], records);
}
