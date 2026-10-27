import { describe, expect, it } from 'vitest';
import { unitTestConfig } from '../test/support/config';
import { ConfigError, loadConfig } from './config';

describe('loadConfig', () => {
  it('applies documented defaults', () => {
    const config = unitTestConfig();
    expect(config.server.port).toBe(4000);
    expect(config.appOrigin).toBe('http://localhost:3000');
    expect(config.storage.driver).toBe('local');
    expect(config.vision.url).toBe('http://localhost:4200');
  });

  it('lists every invalid variable without echoing secret values', () => {
    const secret = 'short-secret';
    let error: unknown;
    try {
      loadConfig({ DATABASE_URL: 'mysql://nope', SESSION_SECRET: secret });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ConfigError);
    const message = (error as ConfigError).message;
    expect(message).toContain('DATABASE_URL');
    expect(message).toContain('SESSION_SECRET');
    expect(message).not.toContain(secret);
  });

  it('treats empty optional values as unset', () => {
    const config = unitTestConfig({ MICROSOFT_CLIENT_ID: '', S3_ENDPOINT: '  ' });
    expect(config.oidc.microsoft).toBeNull();
    expect(config.storage.s3.endpoint).toBeUndefined();
  });

  it('enables Microsoft sign-in only when tenant, client id and secret are all set', () => {
    expect(() => unitTestConfig({ MICROSOFT_CLIENT_ID: 'abc' })).toThrow(ConfigError);
    const config = unitTestConfig({
      MICROSOFT_TENANT_ID: 'tenant-1',
      MICROSOFT_CLIENT_ID: 'client-1',
      MICROSOFT_CLIENT_SECRET: 'secret-1',
    });
    expect(config.oidc.microsoft?.issuer).toBe('https://login.microsoftonline.com/tenant-1/v2.0');
  });

  it('never enables the dev identity provider in production', () => {
    expect(() =>
      unitTestConfig({ NODE_ENV: 'production', DEV_IDP_CLIENT_ID: 'fieldline-web' }),
    ).toThrow(/dev identity provider/);
    expect(unitTestConfig({ DEV_IDP_CLIENT_ID: 'fieldline-web' }).oidc.devIdp?.issuer).toBe(
      'http://localhost:4100',
    );
  });

  it('requires bucket and region for S3 storage', () => {
    expect(() => unitTestConfig({ STORAGE_DRIVER: 's3' })).toThrow(/S3_BUCKET/);
  });

  it('rejects a storage key that is not 32 bytes', () => {
    expect(() =>
      unitTestConfig({ STORAGE_ENCRYPTION_KEY: Buffer.from('too short').toString('base64') }),
    ).toThrow(/STORAGE_ENCRYPTION_KEY/);
  });
});
