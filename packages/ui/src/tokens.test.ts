// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tokensCss } from '../scripts/tokens-css';
import { COLORS, CONTRAST_PAIRS, contrastRatio, type ThemeName } from './tokens';

describe('design tokens', () => {
  for (const theme of ['light', 'dark'] as ThemeName[]) {
    it.each(CONTRAST_PAIRS)(`${theme}: $fg on $bg meets WCAG 2.2 AA ($use)`, ({ fg, bg, min }) => {
      expect(contrastRatio(COLORS[theme][fg], COLORS[theme][bg])).toBeGreaterThanOrEqual(min);
    });
  }

  it('styles.css token section matches tokens.ts (run `npm run tokens` if this fails)', () => {
    // Compare ignoring formatting: Prettier may re-wrap or re-quote the generated block.
    const norm = (t: string) => t.replace(/\s+/g, '').replace(/"/g, "'");
    const css = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');
    expect(norm(css)).toContain(norm(tokensCss()));
  });

  it('defines dark mode for prefers-color-scheme and for an explicit data-theme', () => {
    const css = tokensCss();
    expect(css).toContain('@media (prefers-color-scheme: dark)');
    expect(css).toContain(':root:not([data-theme="light"])');
    expect(css).toContain(':root[data-theme="dark"]');
  });

  it('computes known contrast ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777777', '#777777')).toBe(1);
  });
});
