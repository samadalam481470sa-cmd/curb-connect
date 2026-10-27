#!/usr/bin/env node
// Runs the Python vision worker from its virtual environment on any OS.
//   node infra/scripts/run-vision.mjs serve   -> uvicorn app.main:app on VISION_PORT (default 4200)
//   node infra/scripts/run-vision.mjs test    -> pytest (extra args are passed through)
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serviceDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'services',
  'vision',
);
const python =
  process.platform === 'win32'
    ? join(serviceDir, '.venv', 'Scripts', 'python.exe')
    : join(serviceDir, '.venv', 'bin', 'python');

if (!existsSync(python)) {
  console.error(
    `[vision] virtual environment not found at ${python}.\n` +
      '[vision] Create it first (see services/vision/README.md).',
  );
  process.exit(1);
}

const [command = 'serve', ...rest] = process.argv.slice(2);
const port = process.env.VISION_PORT ?? '4200';
const args = {
  serve: [
    '-m',
    'uvicorn',
    'app.main:app',
    '--host',
    '127.0.0.1',
    '--port',
    port,
    '--reload',
    ...rest,
  ],
  test: ['-m', 'pytest', ...rest],
}[command];

if (!args) {
  console.error(`[vision] unknown command "${command}" (expected "serve" or "test")`);
  process.exit(1);
}

const child = spawn(python, args, { cwd: serviceDir, stdio: 'inherit' });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
