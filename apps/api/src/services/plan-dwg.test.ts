import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { dwgToDxf, looksLikeDwg } from './plan-dwg';

// A real DWG is not checked in (LibreDWG's sample drawings are GPL test data). Set DWG_SAMPLE to a
// .dwg path to run the full conversion locally; CI checks the guards and the error path.
const sample = process.env.DWG_SAMPLE;

describe('AutoCAD DWG reading', () => {
  it('recognizes DWG files by their AC10xx header and refuses anything else', async () => {
    expect(looksLikeDwg(new TextEncoder().encode('AC1015\0\0\0\0'))).toBe(true);
    expect(looksLikeDwg(new TextEncoder().encode('%PDF-1.4 hello'))).toBe(false);
    expect(await dwgToDxf(new TextEncoder().encode('not a drawing'))).toBeNull();
  });

  it('turns damaged DWG bytes into a plain failure, not a crash', async () => {
    const fake = new Uint8Array(4096);
    fake.set(new TextEncoder().encode('AC1015'));
    expect(await dwgToDxf(fake)).toBeNull();
  }, 30_000);

  it.runIf(Boolean(sample && existsSync(sample)))('converts a real DWG to DXF', async () => {
    const dxf = await dwgToDxf(new Uint8Array(readFileSync(sample!)));
    expect(dxf).toMatch(/SECTION/);
    expect(dxf).toMatch(/ENTITIES/);
  }, 60_000);
});
