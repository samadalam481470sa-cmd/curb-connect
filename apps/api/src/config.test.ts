import { describe, expect, it } from 'vitest';
import { unitTestConfig } from '../test/support/config';
import { ConfigError, HUGGING_FACE_ROUTER_URL, loadConfig } from './config';

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

  it('turns on the open model AI from a Hugging Face key alone', () => {
    expect(unitTestConfig().openModel).toBeNull();
    const config = unitTestConfig({ OPEN_MODEL_API_KEY: 'hf_test' });
    expect(config.openModel).toEqual({
      baseUrl: HUGGING_FACE_ROUTER_URL,
      apiKey: 'hf_test',
      model: 'Qwen/Qwen2.5-VL-7B-Instruct',
    });
    const local = unitTestConfig({ OPEN_MODEL_BASE_URL: 'http://localhost:11434/v1' });
    expect(local.openModel?.baseUrl).toBe('http://localhost:11434/v1');
    expect(local.openModel?.apiKey).toBeUndefined();
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

  it('accepts the multi-tenant "common" Microsoft authority', () => {
    const config = unitTestConfig({
      MICROSOFT_TENANT_ID: 'common',
      MICROSOFT_CLIENT_ID: 'client-1',
      MICROSOFT_CLIENT_SECRET: 'secret-1',
    });
    expect(config.oidc.microsoft?.issuer).toBe('https://login.microsoftonline.com/common/v2.0');
  });

  it('enables Google sign-in only when client id and secret are both set', () => {
    expect(unitTestConfig().oidc.google).toBeNull();
    expect(() => unitTestConfig({ GOOGLE_CLIENT_ID: 'abc' })).toThrow(/GOOGLE_CLIENT_SECRET/);
    const config = unitTestConfig({ GOOGLE_CLIENT_ID: 'g-1', GOOGLE_CLIENT_SECRET: 'g-secret' });
    expect(config.oidc.google).toEqual({
      issuer: 'https://accounts.google.com',
      clientId: 'g-1',
      clientSecret: 'g-secret',
    });
  });

  it('never enables the dev identity provider in production', () => {
    expect(() =>
      unitTestConfig({ NODE_ENV: 'production', DEV_IDP_CLIENT_ID: 'fieldline-web' }),
    ).toThrow(/dev identity provider/);
    expect(unitTestConfig({ DEV_IDP_CLIENT_ID: 'fieldline-web' }).oidc.devIdp?.issuer).toBe(
      'http://localhost:4100',
    );
  });

  it('keeps Google Solar unconfigured unless a server-side key is supplied', () => {
    expect(unitTestConfig().imagery.googleSolarApiKey).toBeUndefined();
    expect(
      unitTestConfig({ GOOGLE_SOLAR_API_KEY: 'solar-key-for-tests' }).imagery.googleSolarApiKey,
    ).toBe('solar-key-for-tests');
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
