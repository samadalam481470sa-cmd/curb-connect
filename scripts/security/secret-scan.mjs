#!/usr/bin/env node
// Blocks live credentials from entering the repository. Runs over every git-tracked file, so it
// catches a key pasted into source, docs, fixtures or an example file, not just `.env`.
//
//   npm run security:secrets
//
// Exit 1 prints the file and line (never the value). CI runs this before installing dependencies.
// If it ever fires on a real key: revoke/rotate the key at the provider FIRST, then rewrite history
// (a removed commit is still readable on GitHub until it is expired).
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

/** High-confidence provider formats only: no generic "password =" noise that trains people to ignore it. */
const RULES = [
  { kind: 'stripe-live-secret', re: /\bsk_live_[0-9A-Za-z]{16,}/ },
  { kind: 'stripe-restricted-live', re: /\brk_live_[0-9A-Za-z]{16,}/ },
  { kind: 'stripe-test-secret', re: /\bsk_test_[0-9A-Za-z]{16,}/ },
  { kind: 'stripe-webhook-secret', re: /\bwhsec_[0-9A-Za-z+/=]{16,}/ },
  { kind: 'stripe-publishable-token', re: /\bpk_live_[0-9A-Za-z]{16,}/ },
  { kind: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { kind: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { kind: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { kind: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/ },
  { kind: 'private-key-block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
];

/** Binary/media files cannot hold a pasteable key; skipping them keeps the scan fast. */
const SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.pdf',
  '.zip',
  '.gz',
  '.tgz',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp4',
  '.mov',
  '.wasm',
  '.node',
  '.lockb',
]);
const MAX_BYTES = 2 * 1024 * 1024;

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split('\0').filter(Boolean);
}

function scan(file) {
  if (SKIP_EXTENSIONS.has(extname(file).toLowerCase())) return [];
  let size;
  try {
    size = statSync(file).size;
  } catch {
    return [];
  }
  if (size === 0 || size > MAX_BYTES) return [];
  const buffer = readFileSync(file);
  if (buffer.includes(0)) return []; // binary
  const text = buffer.toString('utf8');
  const findings = [];
  for (const rule of RULES) {
    const match = rule.re.exec(text);
    if (!match) continue;
    const line = text.slice(0, match.index).split('\n').length;
    findings.push({ file, line, kind: rule.kind });
  }
  return findings;
}

const findings = trackedFiles().flatMap(scan);
if (findings.length > 0) {
  console.error('Secret scan failed: credentials found in tracked files.\n');
  for (const f of findings) console.error(`  ${f.file}:${f.line}  ${f.kind}`);
  console.error(
    '\nRevoke and rotate the key before removing it: it is in git history until expired.',
  );
  process.exit(1);
}
console.log(
  `Secret scan passed: ${trackedFiles().length} tracked files, no credential patterns found.`,
);
