// Runs in every integration test worker before the test file. Points DATABASE_URL at the test
// database so code that reads config can never reach fieldline_dev from a test.
import { assertTestDatabaseUrl } from '../src/db/url';
import { loadEnvFiles } from '../src/env';

loadEnvFiles();

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is not set (see test/global-setup.ts).');
assertTestDatabaseUrl(testUrl);

process.env.DATABASE_URL = testUrl;
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL ??= 'silent';
