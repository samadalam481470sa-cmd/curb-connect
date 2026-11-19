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
    id: 'usgs-nsd',
    name: 'USGS National Structures Dataset: point layer (Struct_Point)',
    licence: 'Public domain (USGS: "free downloads of public domain structures data" from The National Map)',
    permissive: true,
    attributionRequired: false,
    verifiedOn: null,
    notes: 'Non-residential structure points (schools, cemeteries, public facilities), not house footprints. Source: The National Map state packages, StagedProducts/Struct/Shape (published 2026-02-27). The data.gov catalog licence field is blank, so a person must confirm the terms before storage. The polygon layers in the same package are USA Structures, listed separately below.',
  },
  {
    id: 'usa-structures',
    name: 'USA Structures (FEMA Geospatial Response Office, ORNL, USGS): building footprints over 450 sq ft',
    licence: 'CC BY 4.0 (stated on the ArcGIS item licenseInfo field, owner Esri_US_Federal_Data)',
    permissive: true,
    attributionRequired: true,
    verifiedOn: null,
    notes: 'Covers all US structures larger than 450 sq ft; the state packages are the Struct_Poly_FEMA_N layers. CC BY 4.0 permits storing and derived work with attribution and has no share-alike clause. Property address fields are excluded from storage (personal data; upstream address provenance not established). A person must review the item page and set verifiedOn before the loader will run.',
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
    licence: 'ODbL-1.0 for the buildings theme (sourced from OpenStreetMap); CDLA-Permissive-2.0 only for other themes',
    permissive: false,
    attributionRequired: true,
    verifiedOn: null,
    notes: 'Checked on docs.overturemaps.org: the buildings theme lists ODbL as its base licence and its records cite OpenStreetMap. Storing derived data needs share-alike compliance, so this is not permissive for buildings.',
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
