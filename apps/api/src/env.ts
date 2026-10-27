import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';

/**
 * Loads apps/api/.env.local then apps/api/.env (if present) into process.env without overriding
 * variables that are already set, so real environment variables (CI, hosting) always win.
 * Resolved relative to this file: src/env.ts and the bundled dist/*.js are both one level below
 * the package root.
 */
export function loadEnvFiles(): void {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  loadDotenv({
    path: [resolve(packageRoot, '.env.local'), resolve(packageRoot, '.env')],
    quiet: true,
  });
}
