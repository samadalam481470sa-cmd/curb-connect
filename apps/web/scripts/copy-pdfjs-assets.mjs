import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const output = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pdfjs');
mkdirSync(output, { recursive: true });
copyFileSync(
  join(pdfjsRoot, 'legacy/build/pdf.worker.min.mjs'),
  join(output, 'pdf.worker.min.mjs'),
);
for (const asset of ['cmaps', 'standard_fonts', 'wasm']) {
  cpSync(join(pdfjsRoot, asset), join(output, asset), { recursive: true });
}
