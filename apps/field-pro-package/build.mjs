import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, 'dist');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [join(root, 'src/calc.ts')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  outfile: join(outDir, 'calc.js'),
  sourcemap: false,
  logLevel: 'info',
});

cpSync(join(root, 'public/index.html'), join(outDir, 'index.html'));
cpSync(join(root, 'public/LICENSE.txt'), join(outDir, 'LICENSE.txt'));
writeFileSync(
  join(outDir, 'README.txt'),
  [
    'Field Pro — Contractor Calculator Package',
    '========================================',
    '',
    'This offline package includes the Field Pro roof and curb calculation engines.',
    '',
    'How to run:',
    '  1. Open index.html in a modern browser, or',
    '  2. From this folder: python3 -m http.server 8765',
    '     then visit http://localhost:8765',
    '',
    'The full signed-in Field Pro workspace (projects, team, media, reports) runs as',
    'the web application from the Field Pro repository / hosted deployment.',
    '',
    'Rates shown in the worked examples are synthetic fixtures for verification,',
    'not market quotes. Replace them with your approved price book in production use.',
    '',
  ].join('\n'),
);

console.log(`Built Field Pro package → ${outDir}`);
