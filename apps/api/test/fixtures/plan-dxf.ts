// A small AutoCAD DXF floor plan in inches: 48' x 32', 6" walls, two bedrooms, a bath, and three
// door blocks inserted with rotation. Written like AutoCAD's ASCII DXF for plan-reading tests.

export function drawPlanDxf(): string {
  const out: (string | number)[] = [];
  const pair = (code: number, value: string | number) => out.push(code, value);
  const ft = (n: number) => n * 12;
  pair(0, 'SECTION'); pair(2, 'HEADER'); pair(9, '$INSUNITS'); pair(70, 1); pair(0, 'ENDSEC');
  pair(0, 'SECTION'); pair(2, 'BLOCKS');
  pair(0, 'BLOCK'); pair(2, 'DOOR36'); pair(10, 0); pair(20, 0);
  pair(0, 'LINE'); pair(8, 'A-DOOR'); pair(10, 0); pair(20, 0); pair(11, 0); pair(21, 36);
  pair(0, 'ARC'); pair(8, 'A-DOOR'); pair(10, 0); pair(20, 0); pair(40, 36); pair(50, 0); pair(51, 90);
  pair(0, 'ENDBLK');
  pair(0, 'ENDSEC');
  pair(0, 'SECTION'); pair(2, 'ENTITIES');
  const poly = (pts: [number, number][]) => {
    pair(0, 'LWPOLYLINE'); pair(8, 'A-WALL'); pair(90, pts.length); pair(70, 1);
    for (const [x, y] of pts) { pair(10, x); pair(20, y); }
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => {
    pair(0, 'LINE'); pair(8, 'A-WALL'); pair(10, x1); pair(20, y1); pair(11, x2); pair(21, y2);
  };
  poly([[0, 0], [ft(48), 0], [ft(48), ft(32)], [0, ft(32)]]);
  poly([[6, 6], [ft(48) - 6, 6], [ft(48) - 6, ft(32) - 6], [6, ft(32) - 6]]);
  line(ft(20), 6, ft(20), ft(32) - 6);
  line(ft(20) + 4.5, 6, ft(20) + 4.5, ft(32) - 6);
  line(ft(20) + 4.5, ft(16), ft(48) - 6, ft(16));
  line(ft(20) + 4.5, ft(16) + 4.5, ft(48) - 6, ft(16) + 4.5);
  for (const [x, y, rot] of [[ft(5), 6, 0], [ft(25), ft(16), 270], [ft(35), ft(16), 270]] as const) {
    pair(0, 'INSERT'); pair(8, 'A-DOOR'); pair(2, 'DOOR36'); pair(10, x); pair(20, y); pair(50, rot);
  }
  const mtext = (x: number, y: number, s: string) => { pair(0, 'MTEXT'); pair(8, 'A-ANNO'); pair(10, x); pair(20, y); pair(40, 9); pair(1, s); };
  mtext(ft(4), ft(20), '{\\fArial|b1;LIVING ROOM}');
  mtext(ft(26), ft(26), 'BEDROOM 1');
  mtext(ft(26), ft(26) - 12, `12'-0" x 14'-0"`);
  mtext(ft(26), ft(10), 'BEDROOM 2');
  mtext(ft(40), ft(10), 'BATH');
  mtext(0, -ft(3), 'FIRST FLOOR PLAN');
  pair(0, 'ENDSEC'); pair(0, 'EOF');
  return out.join('\n');
}
