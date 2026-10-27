// Generates the token section of src/styles.css from src/tokens.ts (the single source of truth).
// Run: npm run tokens -w @fieldline/ui. tokens.test.ts fails if the checked-in CSS drifts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { COLORS, COLOR_ROLES, STATIC_TOKENS } from '../src/tokens.ts';

const START = '/* <tokens:generated> */';
const END = '/* </tokens:generated> */';

function colors(theme: 'light' | 'dark', indent: string): string {
  return COLOR_ROLES.map((r) => `${indent}--fl-color-${r}: ${COLORS[theme][r]};`).join('\n');
}

export function tokensCss(): string {
  const statics = Object.entries(STATIC_TOKENS)
    .map(([k, v]) => `  --fl-${k}: ${v};`)
    .join('\n');
  return [
    START,
    ':root {',
    '  color-scheme: light;',
    statics,
    colors('light', '  '),
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  :root:not([data-theme="light"]) {',
    '    color-scheme: dark;',
    colors('dark', '    '),
    '  }',
    '}',
    ':root[data-theme="dark"] {',
    '  color-scheme: dark;',
    colors('dark', '  '),
    '}',
    END,
  ].join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const path = fileURLToPath(new URL('../src/styles.css', import.meta.url));
  const css = readFileSync(path, 'utf8');
  const a = css.indexOf(START);
  const b = css.indexOf(END);
  if (a < 0 || b < 0) throw new Error('token markers missing in styles.css');
  writeFileSync(path, css.slice(0, a) + tokensCss() + css.slice(b + END.length));
}
