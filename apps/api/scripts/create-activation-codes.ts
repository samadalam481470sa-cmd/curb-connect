// Owner tool: create activation codes and write the plain codes to a file outside the repository.
//
//   npx tsx scripts/create-activation-codes.ts --count 10 --days 365 --label "Owner test" [--out <file>]
//
// Only SHA-256 hashes go into the database. The plain codes are written once, to the --out file
// (default: Documents\curb-connect-activation-codes.txt). That file is a secret: keep it out of git.
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { generateActivationCode, hashActivationCode } from '../src/services/activation-codes';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
}

const count = Number(arg('count', '10'));
const days = Number(arg('days', '365'));
const label = arg('label', '');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = resolve(arg('out', join(homedir(), 'Documents', 'curb-connect-activation-codes.txt')));

if (!Number.isInteger(count) || count < 1 || count > 500) throw new Error('--count must be 1 to 500');
if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error('--days must be 1 to 3650');
const rel = relative(repoRoot, out);
if (!isAbsolute(rel) && !rel.startsWith('..')) {
  throw new Error('Refusing to write plain activation codes inside the repository. Use a path outside it.');
}
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL must be set (owner connection).');

const codes = Array.from({ length: count }, () => generateActivationCode());
const sql = postgres(url, { max: 1 });
try {
  await sql.begin(async (tx) => {
    for (const code of codes) {
      await tx`insert into public.activation_codes (id, code_hash, label, grant_days)
               values (gen_random_uuid(), ${hashActivationCode(code.replace(/-/g, ''))}, ${label}, ${days})`;
    }
  });
} finally {
  await sql.end();
}

mkdirSync(dirname(out), { recursive: true });
const lines = [
  'Curb Connect activation codes. KEEP PRIVATE: each code works once.',
  `Created: ${new Date().toISOString().slice(0, 10)}   Access per code: ${days} days${label ? `   Label: ${label}` : ''}`,
  '',
  ...codes.map((c, i) => `${String(i + 1).padStart(3, '0')}  ${c}`),
  '',
];
writeFileSync(out, lines.join('\n'), { encoding: 'utf8', flag: 'w' });
console.log(`Wrote ${count} codes to ${out}`);
