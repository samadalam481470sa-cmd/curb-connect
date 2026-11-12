/**
 * WebXR hit-test path geometry: actual tracked 3D world points in metres, not inferred LiDAR.
 * The measured length is the 3D polyline length along sampled curb points.
 */
export type WorldPoint = { x:number; y:number; z:number };
export function pathLengthMetres(points: readonly WorldPoint[]): number {
  if (points.length < 2) return 0;
  if (points.length > 200) throw new Error('Too many measurement points');
  let total = 0;
  for (let i=1;i<points.length;i++) {
    const a=points[i-1]!,b=points[i]!;
    if (![a.x,a.y,a.z,b.x,b.y,b.z].every(Number.isFinite)) throw new Error('Invalid tracked position');
    const d=Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z);
    if (d>100) throw new Error('Tracking jumped more than 100 metres; restart the measurement');
    total+=d;
  }
  if(total>300)throw new Error('Split a long cut into multiple measurements');
  return total;
}
export const metresToFeet=(metres:number)=>metres*3.280839895013123;
export const pathLengthFeet=(points:readonly WorldPoint[])=>metresToFeet(pathLengthMetres(points));
