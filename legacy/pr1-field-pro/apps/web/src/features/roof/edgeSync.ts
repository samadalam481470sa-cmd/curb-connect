import { edgeLengthsFt, type EdgeClass, type MapPolygonFacet } from '../map';
import type { RoofEdgeRow } from './draft';

/** Rebuild edge rows from facets, preserving classifications where possible. */
export function syncEdgesFromFacets(
  facets: readonly MapPolygonFacet[],
  previous: readonly RoofEdgeRow[],
): RoofEdgeRow[] {
  const prevByKey = new Map(previous.map((e) => [`${e.facetId}:${e.edgeIndex}`, e]));
  const next: RoofEdgeRow[] = [];
  for (const facet of facets) {
    if (facet.ring.length < 2) continue;
    const lengths = edgeLengthsFt(facet.ring);
    lengths.forEach((ft, edgeIndex) => {
      const key = `${facet.id}:${edgeIndex}`;
      const prior = prevByKey.get(key);
      next.push({
        id: prior?.id ?? `${facet.id}-edge-${edgeIndex}`,
        facetId: facet.id,
        edgeIndex,
        classification: prior?.classification ?? 'unclassified',
        lengthFt: ft.toFixed(2),
      });
    });
  }
  return next;
}

export function aggregateEdgeLengths(edges: readonly RoofEdgeRow[]): Record<EdgeClass, string> {
  const sums: Record<EdgeClass, number> = {
    eave: 0,
    rake: 0,
    ridge: 0,
    hip: 0,
    valley: 0,
    unclassified: 0,
  };
  for (const e of edges) {
    const n = Number(e.lengthFt);
    if (Number.isFinite(n)) sums[e.classification] += n;
  }
  return {
    eave: sums.eave ? sums.eave.toFixed(2) : '',
    rake: sums.rake ? sums.rake.toFixed(2) : '',
    ridge: sums.ridge ? sums.ridge.toFixed(2) : '',
    hip: sums.hip ? sums.hip.toFixed(2) : '',
    valley: sums.valley ? sums.valley.toFixed(2) : '',
    unclassified: sums.unclassified ? sums.unclassified.toFixed(2) : '',
  };
}
