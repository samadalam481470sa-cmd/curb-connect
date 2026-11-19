import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { issueDownloadToken, verifyDownloadToken } from './download-token.mjs';

describe('download tokens', () => {
  before(() => {
    process.env.DOWNLOAD_TOKEN_SECRET = 'test-secret-field-pro-download-token-32b';
  });
  after(() => {
    delete process.env.DOWNLOAD_TOKEN_SECRET;
  });

  it('issues and verifies a token', () => {
    const token = issueDownloadToken('cs_test_123', 'buyer@example.com', 60);
    const data = verifyDownloadToken(token);
    assert.equal(data.sid, 'cs_test_123');
    assert.equal(data.email, 'buyer@example.com');
    assert.equal(data.sku, 'field-pro-license');
  });

  it('rejects tampered tokens', () => {
    const token = issueDownloadToken('cs_test_123', null, 60);
    const [payload] = token.split('.', 2);
    assert.throws(() => verifyDownloadToken(`${payload}.deadbeef`), /signature/);
  });
});
