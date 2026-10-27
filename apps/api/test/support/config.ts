import { type AppConfig, loadConfig } from '../../src/config';

/**
 * A complete, valid config for tests that do not touch a database. The URL points at a database
 * that is never contacted; integration tests use TEST_DATABASE_URL instead.
 */
export function unitTestConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: 'postgres://unit:unit@127.0.0.1:1/unit_test',
    SESSION_SECRET: 'unit-test-session-secret-0123456789abcdef',
    ...overrides,
  });
}
