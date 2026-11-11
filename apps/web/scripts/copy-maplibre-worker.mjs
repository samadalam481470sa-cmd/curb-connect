// Copies MapLibre's module worker into public/ so the browser can load it from our own origin.
// Bundlers rewrite the library's default `new URL('./maplibre-gl-worker.mjs', import.meta.url)`
// to a path that does not exist, which stops tiles and GeoJSON layers from rendering.
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkgPath = require.resolve('maplibre-gl/package.json');
const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'));
const src = join(dirname(pkgPath), 'dist', 'maplibre-gl-worker.mjs');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'maplibre');
mkdirSync(outDir, { recursive: true });
copyFileSync(src, join(outDir, 'maplibre-gl-worker.mjs'));
console.log(`maplibre worker ${version} -> public/maplibre/`);
