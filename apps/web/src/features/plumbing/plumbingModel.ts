/**
 * Lightweight, deterministic 3D building/plumbing geometry.
 * Input coordinates are metres. No information is inferred from photographs or PDF plans.
 * A model is a user-provided structured design, not a sealed engineering design.
 */
export type Point3 = { x: number; y: number; z: number };
export type Room3 = { id: string; name: string; x: number; y: number; width: number; depth: number; height: number };
export type Pipe3 = {
  id: string;
  name: string;
  system: 'cold_water' | 'hot_water' | 'drain' | 'vent' | 'gas' | 'other';
  diameterMm: number;
  points: Point3[];
};
export type BuildingModel = { schemaVersion: 1; units: 'm'; rooms: Room3[]; pipes: Pipe3[] };

const systems = new Set<Pipe3['system']>(['cold_water', 'hot_water', 'drain', 'vent', 'gas', 'other']);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const bounded = (v: unknown, low: number, high: number) => finite(v) && v >= low && v <= high;
const plain = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanName = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= 100;

export function validateBuildingModel(raw: unknown): BuildingModel {
  if (!plain(raw) || raw.schemaVersion !== 1 || raw.units !== 'm') {
    throw new Error('Expected model schemaVersion 1 with units "m".');
  }
  if (!Array.isArray(raw.rooms) || raw.rooms.length > 80 || !Array.isArray(raw.pipes) || raw.pipes.length > 500) {
    throw new Error('Maximum 80 rooms and 500 pipe runs; model must include rooms and pipes arrays.');
  }
  const rooms: Room3[] = raw.rooms.map((value: unknown, index: number) => {
    if (!plain(value) || !cleanName(value.name) || !cleanName(value.id) ||
      !bounded(value.x, -1000, 1000) || !bounded(value.y, -1000, 1000) ||
      !bounded(value.width, 0.1, 500) || !bounded(value.depth, 0.1, 500) ||
      !bounded(value.height, 0.1, 200)) {
      throw new Error('Room ' + (index + 1) + ' has invalid position or dimensions (metres).');
    }
    return {
      id: value.id,
      name: value.name,
      x: value.x as number,
      y: value.y as number,
      width: value.width as number,
      depth: value.depth as number,
      height: value.height as number,
    };
  });
  const pipes: Pipe3[] = raw.pipes.map((value: unknown, index: number) => {
    if (!plain(value) || !cleanName(value.id) || !cleanName(value.name) ||
      !systems.has(value.system as Pipe3['system']) ||
      !bounded(value.diameterMm, 1, 2000) ||
      !Array.isArray(value.points) || value.points.length < 2 || value.points.length > 250) {
      throw new Error('Pipe ' + (index + 1) + ' needs system, diameter and 2–250 3D points.');
    }
    const points: Point3[] = value.points.map((p: unknown) => {
      if (!plain(p) || !bounded(p.x, -1000, 1000) || !bounded(p.y, -1000, 1000) ||
        !bounded(p.z, -100, 400)) {
        throw new Error('Pipe points must have finite x, y and z coordinates in metres.');
      }
      return { x: p.x as number, y: p.y as number, z: p.z as number };
    });
    return {
      id: value.id, name: value.name, system: value.system as Pipe3['system'],
      diameterMm: value.diameterMm as number, points,
    };
  });
  const ids = [...rooms.map((r) => r.id), ...pipes.map((p) => p.id)];
  if (new Set(ids).size !== ids.length) throw new Error('Room and pipe IDs must be unique.');
  return { schemaVersion: 1, units: 'm', rooms, pipes };
}

export function segmentLength(a: Point3, b: Point3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function pipeLength(pipe: Pipe3): number {
  return pipe.points.slice(1).reduce((total, point, i) => total + segmentLength(pipe.points[i]!, point), 0);
}

export function isInsideRoom(point: Point3, room: Room3): boolean {
  const tol = 0.001;
  return point.x >= room.x - tol && point.x <= room.x + room.width + tol &&
    point.y >= room.y - tol && point.y <= room.y + room.depth + tol &&
    point.z >= -tol && point.z <= room.height + tol;
}

/** Flag potentially out-of-envelope points for manual verification; NEVER auto-certify clearance. */
export function modelWarnings(model: BuildingModel): string[] {
  const warnings: string[] = [];
  for (const pipe of model.pipes) {
    const outside = pipe.points.filter(
      (p) => !model.rooms.some((room) => isInsideRoom(p, room)),
    ).length;
    if (outside) warnings.push(pipe.name + ': ' + outside + ' point(s) outside supplied room volumes.');
  }
  if (model.rooms.length === 0) warnings.push('No room geometry provided.');
  return warnings;
}

/** Orthographic 3D projection, with camera azimuth/elevation in degrees. */
export function projectPoint(p: Point3, azimuth: number, elevation: number): { x: number; y: number } {
  const a = (azimuth * Math.PI) / 180;
  const e = (elevation * Math.PI) / 180;
  const horizontal = p.x * Math.cos(a) - p.y * Math.sin(a);
  const depth = p.x * Math.sin(a) + p.y * Math.cos(a);
  return { x: horizontal, y: depth * Math.sin(e) - p.z * Math.cos(e) };
}

export function roomCorners(room: Room3): Point3[] {
  const { x, y, width: w, depth: d, height: h } = room;
  return [
    { x, y, z: 0 }, { x: x+w, y, z: 0 }, { x: x+w, y: y+d, z: 0 },
    { x, y: y+d, z: 0 }, { x, y, z: h }, { x: x+w, y, z: h },
    { x: x+w, y: y+d, z: h }, { x, y: y+d, z: h },
  ];
}

export const SAMPLE_BUILDING: BuildingModel = {
  schemaVersion: 1,
  units: 'm',
  rooms: [
    { id: 'room-1', name: 'Bathroom', x: 0, y: 0, width: 4.2, depth: 3.2, height: 2.6 },
    { id: 'room-2', name: 'Utility room', x: 4.2, y: 0, width: 2.8, depth: 3.2, height: 2.6 },
  ],
  pipes: [
    { id: 'p-cold', name: 'Cold supply', system: 'cold_water', diameterMm: 20,
      points: [{ x: 6.4, y: 0.7, z: 0.45 }, { x: 3.5, y: 0.7, z: 0.45 },
        { x: 1.3, y: 0.7, z: 0.45 }, { x: 1.3, y: 1.7, z: 0.65 }] },
    { id: 'p-hot', name: 'Hot supply', system: 'hot_water', diameterMm: 20,
      points: [{ x: 6.4, y: 1.0, z: 0.5 }, { x: 3.4, y: 1.0, z: 0.5 },
        { x: 2.3, y: 1.0, z: 0.5 }, { x: 2.3, y: 2.1, z: 0.75 }] },
    { id: 'p-drain', name: 'Drain run', system: 'drain', diameterMm: 75,
      points: [{ x: 1.4, y: 2.3, z: 0.12 }, { x: 3.9, y: 2.3, z: 0.1 },
        { x: 6.2, y: 2.3, z: 0.06 }] },
  ],
};
