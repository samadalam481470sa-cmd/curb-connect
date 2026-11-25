import type { JobsiteAnnotationPoint, JobsitePhotoAnnotation } from '@fieldline/contracts';
import sharp, { type OverlayOptions } from 'sharp';
import { problem } from '../../http/problem';

const maxEdge = 1920;
const maxInputPixels = 100_000_000;
const highlight = Buffer.from([255, 177, 55, 255]);
const black = Buffer.from([0, 0, 0, 255]);
type Pixel = { x: number; y: number };

function escapedText(text: string) {
  return text.replace(/[&<>]/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    return '&gt;';
  });
}

export async function renderJobsitePhotoAnnotations(
  original: Buffer,
  annotations: readonly JobsitePhotoAnnotation[],
) {
  const source = await sharp(original, { limitInputPixels: maxInputPixels, failOn: 'error' })
    .rotate()
    .resize(maxEdge, maxEdge, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = source.info;
  if (!annotations.length) return { content: source.data, width, height };
  const ink = Buffer.alloc(width * height * 4);
  const redactions = annotations.some(({ kind }) => kind === 'redaction')
    ? Buffer.alloc(width * height * 4)
    : null;
  const notes: OverlayOptions[] = [];
  const radius = Math.max(1, Math.min(6, Math.round(Math.max(width, height) / 450)));

  function pixel({ x, y }: JobsiteAnnotationPoint): Pixel {
    return { x: Math.round(x * (width - 1)), y: Math.round(y * (height - 1)) };
  }

  function rectangle(layer: Buffer, from: Pixel, to: Pixel, color: Buffer) {
    const minX = Math.max(0, Math.min(from.x, to.x));
    const maxX = Math.min(width - 1, Math.max(from.x, to.x));
    const minY = Math.max(0, Math.min(from.y, to.y));
    const maxY = Math.min(height - 1, Math.max(from.y, to.y));
    if (minX > maxX || minY > maxY) return;
    for (let y = minY; y <= maxY; y++) {
      layer.fill(color, (y * width + minX) * 4, (y * width + maxX + 1) * 4);
    }
  }

  function stroke(from: Pixel, to: Pixel) {
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
    for (let step = 0; step <= steps; step++) {
      const x = Math.round(from.x + ((to.x - from.x) * step) / steps);
      const y = Math.round(from.y + ((to.y - from.y) * step) / steps);
      rectangle(ink, { x: x - radius, y: y - radius }, { x: x + radius, y: y + radius }, highlight);
    }
  }

  for (const annotation of annotations) {
    if (annotation.kind === 'note') {
      if (width < 24 || height < 24)
        throw problem('bad_request', 'The photo is too small for note text.');
      const glyphs = await sharp({
        text: {
          text: '<span foreground="#10212c">' + escapedText(annotation.text) + '</span>',
          font: 'sans 14',
          width: Math.min(320, width - 8),
          dpi: 72,
          rgba: true,
        },
      })
        .png()
        .toBuffer({ resolveWithObject: true });
      if (glyphs.info.height > height - 8)
        throw problem('bad_request', 'Shorten the note to fit the photo.');
      const tileWidth = Math.min(width, glyphs.info.width + 8);
      const tileHeight = Math.min(height, glyphs.info.height + 8);
      const tile = await sharp({
        create: { width: tileWidth, height: tileHeight, channels: 4, background: '#fff1b5' },
      })
        .composite([{ input: glyphs.data, left: 4, top: 4 }])
        .png()
        .toBuffer();
      const at = pixel(annotation.at);
      notes.push({
        input: tile,
        left: Math.min(at.x, width - tileWidth),
        top: Math.min(at.y, height - tileHeight),
      });
      continue;
    }
    const from = pixel(annotation.from);
    const to = pixel(annotation.to);
    if (annotation.kind === 'redaction') {
      if (redactions) rectangle(redactions, from, to, black);
    } else if (annotation.kind === 'box') {
      const cornerA = { x: from.x, y: to.y };
      const cornerB = { x: to.x, y: from.y };
      stroke(from, cornerA);
      stroke(cornerA, to);
      stroke(to, cornerB);
      stroke(cornerB, from);
    } else {
      stroke(from, to);
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const length = Math.max(
        5,
        Math.min(18 * radius, Math.hypot(to.x - from.x, to.y - from.y) / 3),
      );
      for (const direction of [angle - 0.55, angle + 0.55]) {
        stroke(to, {
          x: Math.round(to.x - Math.cos(direction) * length),
          y: Math.round(to.y - Math.sin(direction) * length),
        });
      }
    }
  }
  const raw = { width, height, channels: 4 as const };
  const overlays = [{ input: ink, raw }, ...notes];
  if (redactions) overlays.push({ input: redactions, raw });
  const content = await sharp(source.data).composite(overlays).png().toBuffer();
  return { content, width, height };
}
