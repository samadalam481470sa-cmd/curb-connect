import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePlanText } from '@fieldline/contracts';
import { extractPlanPdfText, hasReadableText } from './plan-pdf';

const FALLBACK = { lengthFt: 50, widthFt: 32, stories: 1, bedrooms: 3, bathrooms: 2, garage: 'two_car', wallHeightFt: 9, roofPitch: 6 } as const;

describe('plan PDF text layer', () => {
  it('reads labels from a CAD-style PDF without AI', async () => {
    const data = new Uint8Array(readFileSync(join(__dirname, '../../test/fixtures/plan-text-layer.pdf')));
    const { text, pages } = await extractPlanPdfText(data);
    expect(pages).toBe(1);
    expect(hasReadableText(text)).toBe(true);
    const out = parsePlanText(text, { ...FALLBACK, bedrooms: 1, bathrooms: 1 });
    expect(out.spec.bedrooms).toBe(3);
    expect(out.spec.bathrooms).toBe(2);
    expect(out.spec.roofPitch).toBe(6);
    expect(out.read).toContain('size');
  });

  it('rejects data that is not a PDF', async () => {
    await expect(extractPlanPdfText(new TextEncoder().encode('not a pdf at all'))).rejects.toThrow();
  });

  it('treats a sheet without words as unreadable', () => {
    expect(hasReadableText(' 12 3 / - ')).toBe(false);
  });
});
