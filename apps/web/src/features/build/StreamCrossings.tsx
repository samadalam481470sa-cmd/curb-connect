'use client';
// Stream / waterway crossings on the land-feasibility site plan, from the USGS National
// Hydrography Dataset (NHD) via POST /v1/site/streams. Self-contained and presentational:
// the parent fetches and passes the result in; this file never calls the API and never
// imports LandFeasibility. A crossing is a flag for a surveyor/engineer, not an engineering
// verdict — NHD itself says its data is "not intended to be used for site-specific
// regulatory determinations". No mapped waterways is an honest empty state, never "clear".
import { z } from 'zod';

export const SiteStreamsResponseSchema = z.object({
  status: z.enum(['found', 'empty', 'upstream_unavailable']),
  message: z.string(),
  crossings: z.array(
    z.object({
      name: z.string(),
      type: z.enum(['stream', 'canal', 'waterway']),
      paths: z.array(
        z.array(z.object({ xFt: z.number(), yFt: z.number() })).min(2),
      ),
    }),
  ),
  source: z.string(),
  sourceUrl: z.string(),
  checkedAt: z.string(),
});
export type SiteStreamsResponse = z.infer<typeof SiteStreamsResponseSchema>;

const CROSSING_LABEL = 'Stream crossing — verify with surveyor/engineer';

export function StreamCrossings({
  parcel,
  streams,
  loading,
}: {
  /** Parcel outline the markers are drawn on, in feet. */
  parcel: { widthFt: number; depthFt: number };
  /** The /v1/site/streams answer, or null when it has not been fetched yet. */
  streams: SiteStreamsResponse | null;
  loading?: boolean;
}) {
  const hasGeometry = streams?.crossings.some((c) => c.paths.length > 0) ?? false;
  return (
    <div className="wb-card">
      <h3>Streams &amp; waterway crossings</h3>
      {loading && <p className="wb-muted">Checking the USGS National Hydrography Dataset…</p>}
      {!loading && streams === null && (
        <p className="wb-muted">
          Pull real ground heights to check this parcel against mapped streams. A crossing is a
          flag to verify with a surveyor/engineer — it is not an engineering verdict.
        </p>
      )}
      {!loading && streams !== null && streams.status === 'upstream_unavailable' && (
        <p className="wb-muted" role="status">
          {streams.message} Checked {new Date(streams.checkedAt).toLocaleString()}. Source:{' '}
          {streams.source}.
        </p>
      )}
      {!loading && streams !== null && streams.status === 'empty' && (
        <p className="wb-muted" role="status">
          No mapped waterways in this parcel. That only means the USGS National Hydrography
          Dataset maps none here — an unmapped ditch or a field condition can still be there, so
          confirm on the ground with a surveyor/engineer before building near a low spot.
          Checked {new Date(streams.checkedAt).toLocaleString()}.
        </p>
      )}
      {!loading && streams !== null && streams.status === 'found' && (
        <>
          <p className="wb-muted" role="status">
            {streams.message}
          </p>
          {hasGeometry && (
            <svg
              className="lf-chart"
              viewBox={`0 0 ${parcel.widthFt} ${parcel.depthFt}`}
              role="img"
              aria-label={`Parcel outline with ${streams.crossings.length} mapped waterway crossing${streams.crossings.length === 1 ? '' : 's'}.`}
              style={{ height: 'auto', maxHeight: 320 }}
            >
              <rect
                x={0}
                y={0}
                width={parcel.widthFt}
                height={parcel.depthFt}
                fill="#12233a"
                stroke="#f5c451"
              />
              {streams.crossings.flatMap((c, ci) =>
                c.paths.map((path, pi) => (
                  <polyline
                    key={`${ci}-${pi}`}
                    points={path
                      .map((p) => `${p.xFt.toFixed(1)},${(parcel.depthFt - p.yFt).toFixed(1)}`)
                      .join(' ')}
                    fill="none"
                    stroke="#4aa3ff"
                    strokeWidth={Math.max(2, parcel.widthFt / 150)}
                    strokeLinecap="round"
                  >
                    <title>{`${c.name} (${c.type}) — ${CROSSING_LABEL}`}</title>
                  </polyline>
                )),
              )}
            </svg>
          )}
          <p className="wb-muted">
            Blue {hasGeometry ? 'lines on the parcel outline' : 'entries below'} are mapped
            waterways (USGS NHD). Alignment is approximate — verify with a surveyor/engineer.
          </p>
          <div className="wb-table-wrap">
            <table className="wb-table">
              <thead>
                <tr>
                  <th>Waterway</th>
                  <th>Type</th>
                  <th>What to do</th>
                </tr>
              </thead>
              <tbody>
                {streams.crossings.map((c) => (
                  <tr key={`${c.type}-${c.name}`}>
                    <td>{c.name}</td>
                    <td>{c.type}</td>
                    <td>{CROSSING_LABEL}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="wb-muted">
            Source: {streams.source} · checked{' '}
            {new Date(streams.checkedAt).toLocaleString()}.
          </p>
        </>
      )}
    </div>
  );
}
