import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { issueDownloadToken, verifyDownloadToken } from './download-token.mjs';

process.env.DOWNLOAD_TOKEN_SECRET = 'test-only-secret-that-is-longer-than-32-characters';
const sid = 'cs_test_1234567890ABCDEF';

function sign(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', process.env.DOWNLOAD_TOKEN_SECRET)
    .update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

test('valid paid-session-scoped token round trips', () => {
  const data = verifyDownloadToken(issueDownloadToken(sid, 60));
  assert.equal(data.sid, sid);
  assert.equal(data.sku, 'field-pro-license');
});

test('rejects tampered signatures', () => {
  const token = issueDownloadToken(sid, 60);
  assert.throws(() => verifyDownloadToken(token.slice(0, -1) + '!'), { statusCode: 401 });
});

test('rejects a correctly signed token for a different product', () => {
  assert.throws(() => verifyDownloadToken(sign({
    sid, sku: 'other-product', exp: Math.floor(Date.now() / 1000) + 60,
  })), { statusCode: 401 });
});

test('rejects malformed and invalid session identifiers', () => {
  assert.throws(() => verifyDownloadToken(sign({
    sid: 'invalid', sku: 'field-pro-license', exp: Math.floor(Date.now() / 1000) + 60,
  })), { statusCode: 401 });
});

test('rejects expired and excessively long-lived tokens', () => {
  const now = Math.floor(Date.now() / 1000);
  for (const exp of [now - 1, now + 86402]) {
    assert.throws(() => verifyDownloadToken(sign({
      sid, sku: 'field-pro-license', exp,
    })), { statusCode: 401 });
  }
  assert.throws(() => issueDownloadToken(sid, 86401), RangeError);
});
