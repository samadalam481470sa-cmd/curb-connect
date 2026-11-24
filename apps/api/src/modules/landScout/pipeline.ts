// Ranked-pipeline export: the Land Scout search results as a spreadsheet (CSV) with a
// direct Google Maps link per parcel — the "ranked spreadsheet" half of the
// land-acquisition-intel skill (github.com/Gonzih/land-acquisition-intel), adapted to
// Field Pro's own Land Scout engine. Every column comes from data Land Scout already
// fetched or scored; nothing is invented. Water/sewer availability is not in CAD data,
// so the column says so honestly instead of guessing.
import type { BuyBox, LandParcel, RankedParcel } from '@fieldline/contracts';
import { csvCell } from '../invoiceIntel/index';
import { pricePerAcre, suitabilityLabel } from './scoring';

export type PipelineRow = RankedParcel & { signals: string[] };

/** Direct Google Maps link for a parcel: coordinates when published, else the address. */
export function googleMapsLink(parcel: LandParcel): string {
  if (parcel.lat !== null && parcel.lon !== null) {
    return `https://maps.google.com/?q=${parcel.lat},${parcel.lon}`;
  }
  const address = [parcel.situsAddress, parcel.city, 'TX', parcel.zip].filter(Boolean).join(', ');
  if (!address) return '';
  return `https://maps.google.com/?q=${encodeURIComponent(address)}`;
}

/** Honest water/sewer column: CAD data carries no availability, so say so when asked. */
export function waterSewerStatus(buyBox: BuyBox): string {
  if (buyBox.needsWater || buyBox.needsSewer) {
    return 'Not in CAD data — confirm with city/utility';
  }
  return 'Not required by buy box';
}

export const PIPELINE_COLUMNS = [
  'Rank',
  'Score',
  'Suitability',
  'County',
  'Parcel ID',
  'Situs address',
  'City',
  'ZIP',
  'Acres',
  'Appraisal use',
  'CAD land value ($)',
  '$/acre (CAD)',
  'Highway (mi)',
  'Highway',
  'Rail (mi)',
  'Railroad',
  'Substation (mi)',
  'Substation',
  'Substation (kV)',
  'Owner',
  'Owner signals',
  'Water/sewer',
  'Google Maps link',
  'Vintage',
  'Source',
] as const;

export function pipelineCsv(rows: PipelineRow[], buyBox: BuyBox): string {
  const water = waterSewerStatus(buyBox);
  const lines = [PIPELINE_COLUMNS.join(',')];
  for (const [i, row] of rows.entries()) {
    const p = row.parcel;
    const ppa = pricePerAcre(p);
    lines.push(
      [
        i + 1,
        row.score.total ?? '',
        suitabilityLabel(row.score.total),
        p.county,
        p.parcelId,
        p.situsAddress ?? '',
        p.city ?? '',
        p.zip ?? '',
        p.acres ?? '',
        p.appraisalUse ?? '',
        p.landValue ?? '',
        ppa === null ? '' : Math.round(ppa),
        p.highwayMiles ?? '',
        p.highwayName ?? '',
        p.railroadMiles ?? '',
        p.railroadName ?? '',
        p.substationMiles ?? '',
        p.substationName ?? '',
        p.substationKv ?? '',
        p.ownerName ?? '',
        row.signals.join('; '),
        water,
        googleMapsLink(p),
        p.vintage ?? '',
        p.source,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return '\uFEFF' + lines.join('\r\n');
}

export function pipelineFilename(at: Date = new Date()): string {
  return `land-scout-pipeline-${at.toISOString().slice(0, 10)}.csv`;
}
