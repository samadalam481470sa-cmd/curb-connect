// A small vector floor plan PDF written by hand, like a CAD export, for plan-reading tests.

/** Builds a one-page PDF from a raw content stream, with a correct cross-reference table. */
export function pdfFromContent(content: string): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1224 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/** Draws a 48' x 32' one-story plan at 1/4" = 1'-0" (18 points per foot), like a CAD export. */
export function drawPlan(options: { scaleNote?: boolean } = {}): Promise<Uint8Array> {
  const S = 18;
  const ox = 60;
  const oy = 120; // bottom-left of the house in PDF space (y up)
  const t = 0.5 * S; // 6" walls
  const L = 48 * S;
  const W = 32 * S;
  const ops: string[] = ['0.7 w'];
  const line = (x1: number, y1: number, x2: number, y2: number) => ops.push(`${x1} ${y1} m ${x2} ${y2} l S`);
  ops.push(`${ox} ${oy} ${L} ${W} re S`, `${ox + t} ${oy + t} ${L - 2 * t} ${W - 2 * t} re S`);
  line(ox + 20 * S, oy + t, ox + 20 * S, oy + W - t);
  line(ox + 20.375 * S, oy + t, ox + 20.375 * S, oy + W - t);
  line(ox + 20.375 * S, oy + 16 * S, ox + L - t, oy + 16 * S);
  line(ox + 20.375 * S, oy + 16.375 * S, ox + L - t, oy + 16.375 * S);
  // Three door swings: 3 ft radius quarter circles.
  for (const [x, y] of [[ox + 5 * S, oy + t], [ox + 25 * S, oy + 16 * S], [ox + 35 * S, oy + 16 * S]] as const) {
    ops.push(`${x + 3 * S} ${y} m ${x + 3 * S} ${y - 1.657 * S} ${x + 1.657 * S} ${y - 3 * S} ${x} ${y - 3 * S} c S`);
  }
  // Overall dimension lines with their strings.
  line(ox, oy + W + 30, ox + L, oy + W + 30);
  line(ox - 30, oy, ox - 30, oy + W);
  const text = (x: number, y: number, str: string) => ops.push(`BT /F1 9 Tf ${x} ${y} Td (${str}) Tj ET`);
  text(ox + L / 2 - 10, oy + W + 34, `48'-0"`);
  text(ox - 52, oy + W / 2, `32'-0"`);
  text(ox + 4 * S, oy + 20 * S, 'LIVING ROOM');
  text(ox + 4 * S, oy + 20 * S - 11, `19'-6" x 31'-0"`);
  text(ox + 26 * S, oy + 26 * S, 'BEDROOM 1');
  text(ox + 26 * S, oy + 26 * S - 11, `12'-0" x 14'-0"`);
  text(ox + 26 * S, oy + 10 * S, 'BEDROOM 2');
  text(ox + 40 * S, oy + 10 * S, 'BATH');
  text(ox, oy - 40, 'FIRST FLOOR PLAN');
  if (options.scaleNote !== false) text(ox + 200, oy - 40, `SCALE: 1/4" = 1'-0"`);
  return Promise.resolve(pdfFromContent(ops.join('\n')));
}
