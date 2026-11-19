// Source licence registry. Every dataset the US building pipeline may ingest must be listed here with
// its terms. A source is only allowed for storage when its terms permit that use without share-alike
// obligations on our own data. Entries marked `verifiedOn: null` must be checked against the
// publisher's current terms before ingestion is enabled.
export type UseKind = 'display' | 'store' | 'redistribute';

export interface SourceLicence {
  id: string;
  name: string;
  licence: string;
  /** Public-domain or permissive terms: storing and redistributing our derived data is allowed. */
  permissive: boolean;
  attributionRequired: boolean;
  /** ISO date the terms were last checked by a person, or null if not yet checked. */
  verifiedOn: string | null;
  notes: string;
}

export const SOURCE_LICENCES: readonly SourceLicence[] = [
  {
    id: 'usgs-3dep',
    name: 'USGS 3D Elevation Program (LiDAR)',
    licence: 'Public domain (US federal work)',
    permissive: true,
    attributionRequired: false,
    verifiedOn: null,
    notes: 'Roof height and shape. Coverage varies by area; confirm tile availability per state.',
  },
  {
    id: 'census-tiger',
    name: 'US Census TIGER/Line boundaries',
    licence: 'Public domain (US federal work)',
    permissive: true,
    attributionRequired: false,
    verifiedOn: null,
    notes: 'State, county and tract boundaries for the state gate and refresh grouping.',
  },
  {
    id: 'overture-buildings',
    name: 'Overture Maps buildings',
    licence: 'CDLA-Permissive-2.0 (release); upstream sources have their own terms',
    permissive: true,
    attributionRequired: true,
    verifiedOn: null,
    notes: 'Permissive release terms. Each upstream source must be checked before storage.',
  },
  {
    id: 'openstreetmap-odbl',
    name: 'OpenStreetMap',
    licence: 'ODbL-1.0',
    permissive: false,
    attributionRequired: true,
    verifiedOn: null,
    notes: 'Share-alike: a derived database must be offered under ODbL. Display with attribution only.',
  },
  {
    id: 'ms-us-buildings-odbl',
    name: 'Microsoft US Building Footprints',
    licence: 'ODbL-1.0',
    permissive: false,
    attributionRequired: true,
    verifiedOn: null,
    notes: 'Share-alike. Not stored by this product; display only with attribution, if at all.',
  },
];

export class LicenceRefused extends Error {}

/**
 * Decide whether a source may be used for a given purpose. Storing or redistributing derived data
 * requires a permissive licence. Display is allowed when the source's own attribution is shown.
 */
export function assertSourceAllowed(sourceId: string, use: UseKind): SourceLicence {
  const source = SOURCE_LICENCES.find((s) => s.id === sourceId);
  if (!source) throw new LicenceRefused(`Unknown data source "${sourceId}". Register its licence first.`);
  if (use !== 'display' && !source.permissive) {
    throw new LicenceRefused(
      `${source.name} (${source.licence}) cannot be used to ${use} derived data in this product.`,
    );
  }
  return source;
}
