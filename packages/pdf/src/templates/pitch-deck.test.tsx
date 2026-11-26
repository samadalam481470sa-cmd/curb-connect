import { describe, expect, it } from 'vitest';
import { pitchDeckFixture } from '../fixtures';
import { collectText, documentFor, renderToBuffer } from '../index';

describe('pitch deck PDF', () => {
  it('renders one draft slide per page with the disclaimer', async () => {
    const text = collectText(documentFor(pitchDeckFixture));
    expect(text).toContain('DRAFT — review before sending');
    expect(text).toContain('300 Crescent Ct — Commercial');
    expect(text).toContain('Value not listed on the permit');
    expect(text).toContain('Slide 1 of 3');
    expect(text).toContain('Field Pro does not send this for you');
    const pdf = await renderToBuffer(pitchDeckFixture);
    expect(pdf.pageCount).toBe(3);
    expect(pdf.sha256).toHaveLength(64);
  });

  it('renders a single-slide deck without crashing', async () => {
    const one = { ...pitchDeckFixture, slides: pitchDeckFixture.slides.slice(0, 1) };
    const pdf = await renderToBuffer(one);
    expect(pdf.pageCount).toBe(1);
  });
});
