// IFC4 (ISO 16739) export and import for walls and storeys. Export writes a valid STEP file with a
// spatial hierarchy (project > site > building > storeys) and extruded-rectangle wall geometry.
// Doors, windows and floor slabs are reported in `skipped` instead of silently dropped: openings
// need IfcOpeningElement hosting, which is not modelled yet. Import reads back what this exporter
// writes (and plain IFC4 walls/storeys with the same geometry form).
import { randomBytes } from 'node:crypto';
import { parseStep, type StepEntity, type StepValue } from './step';
import { segmentLength } from './validate';
import type { BuildingElement, HomeDesign, Level } from './schema';

const IFC_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

/** IFC "compressed" GUID: 128 bits as 22 base-64 characters. */
export function ifcGuid(hex = randomBytes(16).toString('hex')): string {
  let n = BigInt(`0x${hex}`) << 4n; // 132 bits = 22 x 6
  let out = '';
  for (let i = 0; i < 22; i += 1) {
    out = IFC_ALPHABET[Number(n & 63n)] + out;
    n >>= 6n;
  }
  return out;
}

const num = (v: number) => (Number.isInteger(v) ? `${v}.` : v.toFixed(6));
const str = (s: string) => `'${s.replace(/'/g, "''").replace(/[^\x20-\x7e]/g, '?')}'`;
const refs = (ids: number[]) => `(${ids.map((i) => `#${i}`).join(',')})`;

export interface IfcExportResult {
  text: string;
  /** Element ids and reasons that were not written as IFC geometry. */
  skipped: { elementId: string; type: string; reason: string }[];
}

/** Export a home design to an IFC4 STEP file. `guidSeed` makes output deterministic in tests. */
export function exportIfc(design: HomeDesign, options: { guidSeed?: (i: number) => string } = {}): IfcExportResult {
  const lines: string[] = [];
  const skipped: IfcExportResult['skipped'] = [];
  let next = 1;
  const add = (body: string): number => {
    const id = next;
    lines.push(`#${id}=${body};`);
    next += 1;
    return id;
  };
  const guidFor = (i: number) => (options.guidSeed ? options.guidSeed(i) : ifcGuid());

  const origin = add(`IFCCARTESIANPOINT((${num(0)},${num(0)},${num(0)}))`);
  const zDir = add(`IFCDIRECTION((${num(0)},${num(0)},${num(1)}))`);
  const xDir = add(`IFCDIRECTION((${num(1)},${num(0)},${num(0)}))`);
  const worldAxis = add(`IFCAXIS2PLACEMENT3D(#${origin},#${zDir},#${xDir})`);
  const context = add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,#${worldAxis},$)`);
  const metre = add(`IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)`);
  const units = add(`IFCUNITASSIGNMENT((#${metre}))`);
  const localRoot = add(`IFCLOCALPLACEMENT($,#${worldAxis})`);

  let guidIndex = 0;
  const guid = () => str(guidFor((guidIndex += 1)));
  const projectId = add(`IFCPROJECT(${guid()},$,${str(design.name)},$,$,$,$,(#${context}),#${units})`);
  const siteId = add(`IFCSITE(${guid()},$,${str('Site')},$,$,#${localRoot},$,$,.ELEMENT.,$,$,$,$,$)`);
  const buildingId = add(`IFCBUILDING(${guid()},$,${str(design.name)},$,$,#${localRoot},$,$,.ELEMENT.,$,$,$)`);
  add(`IFCRELAGGREGATES(${guid()},$,$,$,#${projectId},(#${siteId}))`);
  add(`IFCRELAGGREGATES(${guid()},$,$,$,#${siteId},(#${buildingId}))`);

  const storeyIds = new Map<number, number>();
  const sortedLevels = [...design.levels].sort((a, b) => a.index - b.index);
  for (const level of sortedLevels) {
    const placement = add(`IFCLOCALPLACEMENT(#${localRoot},#${add(
      `IFCAXIS2PLACEMENT3D(#${add(`IFCCARTESIANPOINT((${num(0)},${num(0)},${num(level.elevationM)}))`)},#${zDir},#${xDir})`,
    )})`);
    const storey = add(
      `IFCBUILDINGSTOREY(${guid()},$,${str(level.name)},$,$,#${placement},$,$,.ELEMENT.,${num(level.elevationM)})`,
    );
    storeyIds.set(level.index, storey);
  }
  if (storeyIds.size > 0) {
    add(`IFCRELAGGREGATES(${guid()},$,$,$,#${buildingId},${refs([...storeyIds.values()])})`);
  }

  const wallsByLevel = new Map<number, number[]>();
  for (const el of design.elements) {
    if (el.type !== 'wall') {
      skipped.push({
        elementId: el.id,
        type: el.type,
        reason: el.type === 'door' || el.type === 'window' ? 'opening hosting not modelled in IFC export' : 'element type not exported',
      });
      continue;
    }
    const storey = storeyIds.get(el.level);
    if (storey === undefined) {
      skipped.push({ elementId: el.id, type: el.type, reason: 'level not found' });
      continue;
    }
    const level = sortedLevels.find((l) => l.index === el.level) as Level;
    const wallId = writeWall(add, el, level.elevationM, guid, zDir, xDir, context);
    const bucket = wallsByLevel.get(el.level) ?? [];
    bucket.push(wallId);
    wallsByLevel.set(el.level, bucket);
  }
  for (const [level, ids] of wallsByLevel) {
    add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid()},$,$,$,${refs(ids)},#${storeyIds.get(level)})`);
  }

  const header = [
    'ISO-10303-21;',
    'HEADER;',
    "FILE_DESCRIPTION(('ViewDefinition [DesignTransferView_V1.0]'),'2;1');",
    `FILE_NAME(${str(`${design.name}.ifc`)},'1970-01-01T00:00:00',(),(),'Curb Connect','Curb Connect','');`,
    "FILE_SCHEMA(('IFC4'));",
    'ENDSEC;',
    'DATA;',
  ];
  const text = [...header, ...lines, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
  return { text, skipped };
}

function writeWall(
  add: (body: string) => number,
  el: BuildingElement,
  elevation: number,
  guid: () => string,
  zDir: number,
  xDir: number,
  context: number,
): number {
  const length = segmentLength(el);
  const dx = (el.end.x - el.start.x) / length;
  const dy = (el.end.y - el.start.y) / length;
  const origin = add(`IFCCARTESIANPOINT((${num(el.start.x)},${num(el.start.y)},${num(elevation)}))`);
  const refDir = add(`IFCDIRECTION((${num(dx)},${num(dy)},${num(0)}))`);
  const axis = add(`IFCAXIS2PLACEMENT3D(#${origin},#${zDir},#${refDir})`);
  const placement = add(`IFCLOCALPLACEMENT($,#${axis})`);
  // Profile is centred on the wall's local origin, so the wall axis runs from start to end.
  const profilePos = add(`IFCAXIS2PLACEMENT2D(#${add(`IFCCARTESIANPOINT((${num(length / 2)},${num(0)}))`)},$)`);
  const profile = add(`IFCRECTANGLEPROFILEDEF(.AREA.,${str(el.name)},#${profilePos},${num(length)},${num(el.thicknessM)})`);
  const solid = add(`IFCEXTRUDEDAREASOLID(#${profile},#${add(`IFCAXIS2PLACEMENT3D(#${add(`IFCCARTESIANPOINT((${num(0)},${num(0)},${num(0)}))`)},#${zDir},#${xDir})`)},#${zDir},${num(el.heightM)})`);
  const body = add(`IFCSHAPEREPRESENTATION(#${context},'Body','SweptSolid',(#${solid}))`);
  const shape = add(`IFCPRODUCTDEFINITIONSHAPE($,$,(#${body}))`);
  return add(`IFCWALL(${guid()},$,${str(el.name)},$,$,#${placement},#${shape},$,.STANDARD.)`);
}

export interface IfcImportResult {
  name: string;
  levels: { name: string; elevationM: number }[];
  walls: {
    name: string;
    level: number;
    start: { x: number; y: number };
    end: { x: number; y: number };
    heightM: number;
    thicknessM: number;
  }[];
  warnings: string[];
}

const asNum = (v: StepValue | undefined): number => {
  if (!v) throw new Error('missing number');
  if (v.kind === 'num') return v.value;
  if (v.kind === 'typed' && v.args[0]?.kind === 'num') return v.args[0].value;
  throw new Error('expected number');
};
const asStr = (v: StepValue | undefined): string => (v?.kind === 'str' ? v.value : '');

function pointOf(entities: Map<number, StepEntity>, ref: StepValue | undefined): number[] {
  if (ref?.kind !== 'ref') throw new Error('expected point reference');
  const e = entities.get(ref.id);
  if (!e || e.name !== 'IFCCARTESIANPOINT') throw new Error(`#${ref.id} is not a cartesian point`);
  const coords = (e.args[0] as { kind: 'list'; items: StepValue[] }).items.map(asNum);
  return [coords[0] ?? 0, coords[1] ?? 0, coords[2] ?? 0];
}

function placementOf(entities: Map<number, StepEntity>, ref: StepValue | undefined): { origin: number[]; xAxis: number[] } {
  if (ref?.kind !== 'ref') throw new Error('expected placement reference');
  const e = entities.get(ref.id);
  // IfcLocalPlacement wraps a relative placement; only that relative placement is read here.
  if (e?.name === 'IFCLOCALPLACEMENT') return placementOf(entities, e.args[1]);
  if (!e || e.name !== 'IFCAXIS2PLACEMENT3D') throw new Error('unsupported placement');
  const origin = pointOf(entities, e.args[0]);
  const refDirRef = e.args[2];
  let xAxis = [1, 0, 0];
  if (refDirRef?.kind === 'ref') {
    const d = entities.get(refDirRef.id);
    const v = d && d.args[0] && d.args[0].kind === 'list' ? d.args[0].items.map(asNum) : [1, 0, 0];
    xAxis = [v[0] ?? 1, v[1] ?? 0, v[2] ?? 0];
  }
  return { origin, xAxis };
}

/**
 * Read walls and storeys from an IFC4 STEP file. Only extruded-rectangle walls are supported; any
 * other wall geometry is reported in `warnings` and skipped.
 */
export function importIfc(text: string): IfcImportResult {
  const entities = parseStep(text);
  const warnings: string[] = [];
  const projectEntity = [...entities.values()].find((e) => e.name === 'IFCPROJECT');
  const name = projectEntity ? asStr(projectEntity.args[2]) : '';

  const storeys = new Map<number, { name: string; elevationM: number; index: number }>();
  let index = 0;
  for (const e of entities.values()) {
    if (e.name !== 'IFCBUILDINGSTOREY') continue;
    storeys.set(e.id, { name: asStr(e.args[2]), elevationM: asNum(e.args[9]), index });
    index += 1;
  }

  const wallStorey = new Map<number, number>();
  for (const e of entities.values()) {
    if (e.name !== 'IFCRELCONTAINEDINSPATIALSTRUCTURE') continue;
    const structure = e.args[5];
    const elements = e.args[4];
    if (structure?.kind !== 'ref' || elements?.kind !== 'list') continue;
    for (const item of elements.items) {
      if (item.kind === 'ref') wallStorey.set(item.id, structure.id);
    }
  }

  const walls: IfcImportResult['walls'] = [];
  for (const e of entities.values()) {
    if (e.name !== 'IFCWALL' && e.name !== 'IFCWALLSTANDARDCASE') continue;
    const storeyRef = wallStorey.get(e.id);
    const storey = storeyRef !== undefined ? storeys.get(storeyRef) : undefined;
    const reject = (why: string) => warnings.push(`wall #${e.id} (${asStr(e.args[2])}): ${why}`);
    try {
      const placement = placementOf(entities, e.args[5]);
      const shape = entities.get(e.args[6]?.kind === 'ref' ? e.args[6].id : -1);
      const rep = shape && shape.args[2]?.kind === 'list' ? shape.args[2].items[0] : undefined;
      const body = rep?.kind === 'ref' ? entities.get(rep.id) : undefined;
      const solidRef = body && body.args[3]?.kind === 'list' ? body.args[3].items[0] : undefined;
      const solid = solidRef?.kind === 'ref' ? entities.get(solidRef.id) : undefined;
      if (!solid || solid.name !== 'IFCEXTRUDEDAREASOLID') {
        reject('geometry is not an extruded area solid');
        continue;
      }
      const profileRef = solid.args[0];
      const profile = profileRef?.kind === 'ref' ? entities.get(profileRef.id) : undefined;
      if (!profile || profile.name !== 'IFCRECTANGLEPROFILEDEF') {
        reject('profile is not a rectangle');
        continue;
      }
      const length = asNum(profile.args[3]);
      const thickness = asNum(profile.args[4]);
      const height = asNum(solid.args[3]);
      const [ox, oy] = placement.origin;
      const [ax, ay] = placement.xAxis;
      const sx = ox ?? 0;
      const sy = oy ?? 0;
      walls.push({
        name: asStr(e.args[2]),
        level: storey?.index ?? 0,
        start: { x: sx, y: sy },
        end: { x: sx + (ax ?? 1) * length, y: sy + (ay ?? 0) * length },
        heightM: height,
        thicknessM: thickness,
      });
    } catch (err) {
      reject(err instanceof Error ? err.message : 'unreadable');
    }
  }

  return {
    name,
    levels: [...storeys.values()].sort((a, b) => a.index - b.index).map((s) => ({ name: s.name, elevationM: s.elevationM })),
    walls,
    warnings,
  };
}
