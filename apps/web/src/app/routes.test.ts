// @vitest-environment node
// Guards against two App Router files serving the same URL. Route groups such as (app) and
// (public) do not appear in the URL, so app/page.tsx and app/(app)/page.tsx both resolve to "/".
// The build accepted that silently and served the old foundation placeholder at "/" instead of the
// signed-in Home dashboard, so this check runs in the unit suite.
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const APP_DIR = fileURLToPath(new URL('.', import.meta.url));
const ENTRY = /^(page|route)\.(tsx|ts|jsx|js)$/;

function entries(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return entries(path);
    return ENTRY.test(name) ? [path] : [];
  });
}

/** URL path for an App Router entry file: route groups vanish, private folders never route. */
export function urlFor(file: string): string | null {
  const segments = relative(APP_DIR, file).split(sep).slice(0, -1);
  if (segments.some((s) => s.startsWith('_') || s.startsWith('@'))) return null;
  const url = segments.filter((s) => !(s.startsWith('(') && s.endsWith(')'))).join('/');
  return `/${url}`;
}

describe('App Router routes', () => {
  it('maps route groups out of the URL', () => {
    expect(urlFor(join(APP_DIR, '(app)', 'page.tsx'))).toBe('/');
    expect(urlFor(join(APP_DIR, '(app)', 'roof', 'page.tsx'))).toBe('/roof');
    expect(urlFor(join(APP_DIR, '(public)', 'invite', '[token]', 'page.tsx'))).toBe(
      '/invite/[token]',
    );
  });

  it('serves every URL from exactly one page or route file', () => {
    const byUrl = new Map<string, string[]>();
    for (const file of entries(APP_DIR)) {
      const url = urlFor(file);
      if (url === null) continue;
      byUrl.set(url, [...(byUrl.get(url) ?? []), relative(APP_DIR, file)]);
    }
    const duplicates = [...byUrl.entries()].filter(([, files]) => files.length > 1);
    expect(duplicates).toEqual([]);
    // The signed-in Home dashboard owns "/".
    expect(byUrl.get('/')).toEqual([join('(app)', 'page.tsx')]);
  });
});
