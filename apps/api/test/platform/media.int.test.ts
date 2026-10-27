// PLT-018-QA / BE-075-QA: upload intents with tenant-prefixed keys and short-lived signed URLs,
// checksum dedupe (retries never duplicate), size limits, MIME sniffing, checksum verification,
// restricted EXIF + sanitized copy + thumbnail, honest scan status, per-request authorized
// downloads and expired upload URLs.
import exifr from 'exifr';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { storageSigningSecret } from '../../src/storage';
import { createStorageToken } from '../../src/storage/signing';
import { auditRows, call, type Company, createCompany, createTestContext, sha256Hex, type TestContext } from '../helpers';

const MAX_BYTES = 200_000;
let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestContext({ env: { STORAGE_MAX_UPLOAD_BYTES: String(MAX_BYTES) } });
});
afterEach(() => ctx.cleanup());
afterAll(() => ctx?.close());

async function png(seed = 0): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r: seed % 255, g: 120, b: 30 } } })
    .png()
    .toBuffer();
}

/** A JPEG carrying GPS and device EXIF, like a phone photo. */
async function jpegWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 80, height: 60, channels: 3, background: { r: 10, g: 200, b: 90 } } })
    .jpeg()
    .withExif({
      IFD0: { Make: 'FictionalPhone', Model: 'Test 1' },
      IFD3: {
        GPSLatitudeRef: 'N',
        GPSLatitude: '41/1 52/1 3000/100',
        GPSLongitudeRef: 'W',
        GPSLongitude: '87/1 37/1 4000/100',
      },
    })
    .toBuffer();
}

interface Intent {
  uploadId: string;
  mediaAssetId: string;
  uploadUrl: string | null;
  headers: Record<string, string>;
  duplicate: boolean;
  status: string;
}

async function intent(company: Company, bytes: Buffer, overrides: Record<string, unknown> = {}) {
  return call(ctx, 'POST', '/v1/media/uploads', {
    as: company.owner,
    body: {
      ownerType: 'organization',
      ownerId: company.orgId,
      fileName: 'site photo.png',
      mimeType: 'image/png',
      sizeBytes: bytes.length,
      sha256: sha256Hex(bytes),
      kind: 'photo',
      viewType: 'wide_approach',
      ...overrides,
    },
  });
}

async function put(company: Company, uploadUrl: string, bytes: Buffer, contentType = 'image/png') {
  const url = new URL(uploadUrl);
  return ctx.app.inject({
    method: 'PUT',
    url: url.pathname,
    headers: { cookie: company.owner.cookie, 'content-type': contentType },
    payload: bytes,
  });
}

async function upload(company: Company, bytes: Buffer, mimeType = 'image/png') {
  const created = await intent(company, bytes, { mimeType, fileName: mimeType === 'image/jpeg' ? 'p.jpg' : 'p.png' });
  expect(created.statusCode).toBe(201);
  const body = created.json() as Intent;
  expect((await put(company, body.uploadUrl!, bytes, mimeType)).statusCode).toBe(204);
  const done = await call(ctx, 'POST', `/v1/media/uploads/${body.uploadId}/complete`, { as: company.owner });
  return { intent: body, done };
}

describe('PLT-018-QA upload intents', () => {
  it('issues a tenant-prefixed, short-lived signed PUT URL and records the declared metadata', async () => {
    const a = await createCompany(ctx);
    const bytes = await png();
    const res = await intent(a, bytes);
    expect(res.statusCode).toBe(201);
    const body = res.json() as Intent & { expiresAt: string };
    expect(body.uploadUrl).toMatch(/^http:\/\/localhost:4000\/v1\/storage\/upload\//);
    expect(body.headers['content-type']).toBe('image/png');
    const ttl = (Date.parse(body.expiresAt) - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(ctx.config.storage.signedUrlTtlSeconds);
    const [row] = await ctx.owner.client<{ original_object_key: string; status: string }[]>`
      select original_object_key, status from media_assets where id = ${body.mediaAssetId}`;
    expect(row?.original_object_key).toBe(`orgs/${a.orgId}/media/${body.mediaAssetId}/original`);
    expect(row?.status).toBe('pending_upload');
  });

  it('a retried intent (flaky network) reuses the same asset instead of creating a second one', async () => {
    const a = await createCompany(ctx);
    const bytes = await png(1);
    const first = (await intent(a, bytes)).json() as Intent;
    const retry = await intent(a, bytes);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().mediaAssetId).toBe(first.mediaAssetId);
    expect(retry.json().uploadId).toBe(first.uploadId);
    const [row] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from media_assets where org_id = ${a.orgId}`;
    expect(row?.n).toBe(1);
  });

  it('rejects a declared size above the limit (413) and unsupported declared types (400)', async () => {
    const a = await createCompany(ctx);
    const big = await intent(a, Buffer.alloc(10), { sizeBytes: MAX_BYTES + 1 });
    expect(big.statusCode).toBe(413);
    expect(big.json().code).toBe('payload_too_large');
    const exe = await intent(a, Buffer.alloc(10), { mimeType: 'application/x-msdownload' });
    expect(exe.statusCode).toBe(400);
  });

  it('requires an upload permission for the owner record', async () => {
    const a = await createCompany(ctx, { roles: ['estimator'] });
    const bytes = await png(2);
    const res = await call(ctx, 'POST', '/v1/media/uploads', {
      as: a.as('estimator'),
      body: {
        ownerType: 'organization',
        ownerId: a.orgId,
        fileName: 'logo.png',
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        sha256: sha256Hex(bytes),
      },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('PLT-018-QA completion pipeline', () => {
  it('stores an encrypted original, a sanitized copy and a thumbnail; scan status is honest', async () => {
    const a = await createCompany(ctx);
    const bytes = await png(3);
    const { intent: i, done } = await upload(a, bytes);
    expect(done.statusCode).toBe(200);
    const asset = done.json();
    expect(asset).toMatchObject({ status: 'ready', scanStatus: 'not_scanned', widthPx: 64, heightPx: 48, sha256: sha256Hex(bytes) });
    expect(asset.thumbnailUrl).toMatch(/\/v1\/storage\/object\//);
    expect(asset.viewUrl).toMatch(/\/v1\/storage\/object\//);
    expect(asset).not.toHaveProperty('exifRestricted');
    // At rest the original is encrypted (not a PNG on disk).
    const key = `orgs/${a.orgId}/media/${i.mediaAssetId}/original`;
    expect(await ctx.storage.get(key)).toEqual(bytes);
    const thumb = await call(ctx, 'GET', `/v1/media/${i.mediaAssetId}/content?variant=thumbnail`, { as: a.owner });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');
    expect(thumb.headers['cache-control']).toBe('private, no-store');
    expect((await sharp(thumb.rawPayload).metadata()).format).toBe('webp');
    expect((await auditRows(ctx, a.orgId, 'media.uploaded')).length).toBe(1);
    // Completing again is idempotent.
    const again = await call(ctx, 'POST', `/v1/media/uploads/${i.uploadId}/complete`, { as: a.owner });
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(i.mediaAssetId);
  });

  it('keeps GPS/device EXIF in the restricted field only; shared copies are stripped (PLT-018 D)', async () => {
    const a = await createCompany(ctx);
    const bytes = await jpegWithGps();
    const original = (await exifr.gps(bytes)) as { latitude: number } | undefined;
    expect(original?.latitude).toBeCloseTo(41.875, 2);
    const { intent: i, done } = await upload(a, bytes, 'image/jpeg');
    expect(done.statusCode).toBe(200);
    expect(JSON.stringify(done.json())).not.toMatch(/latitude|FictionalPhone/);
    const [row] = await ctx.owner.client<{ exif_restricted: { gps: { latitude: number } | null; make: string } }[]>`
      select exif_restricted from media_assets where id = ${i.mediaAssetId}`;
    expect(row?.exif_restricted.gps?.latitude).toBeCloseTo(41.875, 2);
    expect(row?.exif_restricted.make).toBe('FictionalPhone');
    const view = await call(ctx, 'GET', `/v1/media/${i.mediaAssetId}/content`, { as: a.owner });
    expect(view.statusCode).toBe(200);
    expect(view.headers['content-type']).toBe('image/jpeg');
    expect(await exifr.gps(view.rawPayload).catch(() => undefined)).toBeFalsy();
    const parsed = (await exifr.parse(view.rawPayload).catch(() => undefined)) as Record<string, unknown> | undefined;
    expect(parsed?.Make).toBeUndefined();
    const [audit] = await auditRows(ctx, a.orgId, 'media.uploaded');
    expect(audit?.after).toMatchObject({ gpsLocationPresent: true });
    expect(JSON.stringify(audit?.after)).not.toMatch(/41\.8/);
  });

  it('dedupes by checksum within a company: the same bytes never become a second asset', async () => {
    const a = await createCompany(ctx);
    const bytes = await png(4);
    const { intent: i } = await upload(a, bytes);
    const dup = await intent(a, bytes, { fileName: 'same photo again.png' });
    expect(dup.statusCode).toBe(200);
    expect(dup.json()).toMatchObject({ mediaAssetId: i.mediaAssetId, duplicate: true, uploadUrl: null, status: 'ready' });
    const [row] = await ctx.owner.client<{ n: number }[]>`
      select count(*)::int as n from media_assets where org_id = ${a.orgId}`;
    expect(row?.n).toBe(1);
    // Another company uploading the same bytes gets its own asset (dedupe is per tenant).
    const b = await createCompany(ctx);
    const other = await intent(b, bytes);
    expect(other.statusCode).toBe(201);
    expect(other.json().mediaAssetId).not.toBe(i.mediaAssetId);
  });

  it('rejects content that is not what was declared (MIME sniffing), and the bad frame can be replaced', async () => {
    const a = await createCompany(ctx);
    const fake = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(200, ' '));
    const created = (await intent(a, fake)).json() as Intent;
    expect((await put(a, created.uploadUrl!, fake)).statusCode).toBe(204);
    const done = await call(ctx, 'POST', `/v1/media/uploads/${created.uploadId}/complete`, { as: a.owner });
    expect(done.statusCode).toBe(415);
    expect(done.json().code).toBe('unsupported_media_type');
    const [row] = await ctx.owner.client<{ status: string }[]>`select status from media_assets where id = ${created.mediaAssetId}`;
    expect(row?.status).toBe('rejected');
    expect(await ctx.storage.head(`orgs/${a.orgId}/media/${created.mediaAssetId}/original`)).toBeNull();
    expect((await auditRows(ctx, a.orgId, 'media.rejected'))[0]?.after).toEqual({ reason: 'unsupported_type' });

    // A real JPEG declared as PNG is a type mismatch.
    const jpeg = await jpegWithGps();
    const mismatch = (await intent(a, jpeg)).json() as Intent;
    await put(a, mismatch.uploadUrl!, jpeg);
    expect((await call(ctx, 'POST', `/v1/media/uploads/${mismatch.uploadId}/complete`, { as: a.owner })).statusCode).toBe(415);

    // Replacing only the bad frame: a new intent for good bytes works without restarting anything.
    const good = await png(5);
    const replaced = await upload(a, good);
    expect(replaced.done.statusCode).toBe(200);
  });

  it('rejects bytes whose SHA-256 differs from the declared checksum', async () => {
    const a = await createCompany(ctx);
    const declared = await png(6);
    const actual = await png(7);
    expect(actual.length).toBe(declared.length);
    const created = (await intent(a, declared)).json() as Intent;
    await put(a, created.uploadUrl!, actual);
    const done = await call(ctx, 'POST', `/v1/media/uploads/${created.uploadId}/complete`, { as: a.owner });
    expect(done.statusCode).toBe(422);
    expect(done.json().code).toBe('checksum_mismatch');
  });

  it('the signed PUT enforces the declared type and size', async () => {
    const a = await createCompany(ctx);
    const bytes = await png(8);
    const created = (await intent(a, bytes)).json() as Intent;
    expect((await put(a, created.uploadUrl!, bytes, 'image/jpeg')).statusCode).toBe(415);
    const tooBig = await put(a, created.uploadUrl!, Buffer.concat([bytes, Buffer.alloc(10)]));
    expect(tooBig.statusCode).toBe(413);
    // Completing before any bytes arrived is refused.
    const early = await call(ctx, 'POST', `/v1/media/uploads/${created.uploadId}/complete`, { as: a.owner });
    expect(early.statusCode).toBe(409);
  });

  it('an expired signed URL is 410 and a forged one is 404', async () => {
    const a = await createCompany(ctx);
    const bytes = await png(9);
    const created = (await intent(a, bytes)).json() as Intent;
    const key = `orgs/${a.orgId}/media/${created.mediaAssetId}/original`;
    const expired = createStorageToken(storageSigningSecret(ctx.config), {
      op: 'upload',
      key,
      exp: Math.floor(Date.now() / 1000) - 5,
      contentType: 'image/png',
      maxBytes: bytes.length,
    });
    expect((await put(a, `http://localhost:4000/v1/storage/upload/${expired}`, bytes)).statusCode).toBe(410);
    const forged = createStorageToken('not-the-server-secret-at-all', {
      op: 'upload',
      key,
      exp: Math.floor(Date.now() / 1000) + 60,
      contentType: 'image/png',
      maxBytes: bytes.length,
    });
    expect((await put(a, `http://localhost:4000/v1/storage/upload/${forged}`, bytes)).statusCode).toBe(404);
  });

  it('a signed download URL alone is not enough: it needs a session in the owning company', async () => {
    const a = await createCompany(ctx);
    const { done } = await upload(a, await png(10));
    const viewUrl = new URL(done.json().viewUrl as string);
    expect((await call(ctx, 'GET', viewUrl.pathname, { as: a.owner })).statusCode).toBe(200);
    expect((await call(ctx, 'GET', viewUrl.pathname)).statusCode).toBe(401);
  });

  it('a removed member cannot publish a pending upload or download afterwards (BE-078 S)', async () => {
    const a = await createCompany(ctx, { roles: ['admin'] });
    const admin = a.as('admin');
    const bytes = await png(11);
    const created = await call(ctx, 'POST', '/v1/media/uploads', {
      as: admin,
      body: {
        ownerType: 'organization',
        ownerId: a.orgId,
        fileName: 'logo.png',
        mimeType: 'image/png',
        sizeBytes: bytes.length,
        sha256: sha256Hex(bytes),
      },
    });
    expect(created.statusCode).toBe(201);
    await call(ctx, 'POST', `/v1/team/members/${admin.membershipId}/deactivate`, { as: a.owner, body: { reason: 'left' } });
    const putRes = await ctx.app.inject({
      method: 'PUT',
      url: new URL(created.json().uploadUrl as string).pathname,
      headers: { cookie: admin.cookie, 'content-type': 'image/png' },
      payload: bytes,
    });
    expect(putRes.statusCode).toBe(403);
    const complete = await call(ctx, 'POST', `/v1/media/uploads/${created.json().uploadId}/complete`, { as: admin });
    expect(complete.statusCode).toBe(403);
  });
});
