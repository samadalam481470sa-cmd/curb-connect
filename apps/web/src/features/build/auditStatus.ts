// Feasibility audit-status panel data (audit-gaps round 2): every input and
// factor behind a land-feasibility run, with where it actually came from —
//   verified            a live source answered for this run (source named)
//   estimated           computed by Field Pro from the inputs above
//   contractor_entered  typed in by the contractor (including painted judgment)
//   missing             no source connected / nothing entered yet
// The statuses are derived from the run's real state (the same state the
// sections above read), so the panel cannot claim a source that did not
// answer. Pure: the component passes facts, this module words the rows.

export type AuditStatusKind = 'verified' | 'estimated' | 'contractor_entered' | 'missing';

export interface AuditStatusRow {
  factor: string;
  status: AuditStatusKind;
  detail: string;
}

export const AUDIT_STATUS_LABEL: Record<AuditStatusKind, string> = {
  verified: 'Verified — live source',
  estimated: 'Estimated',
  contractor_entered: 'Contractor-entered',
  missing: 'Missing — no source',
};

export interface FeasibilityAuditFacts {
  /** USGS terrain source string when ground data was pulled for this run. */
  terrainSource: string | null;
  /** FEMA flood zone when flood data loaded for this run. */
  floodZone: string | null;
  /** FEMA flood source string when flood data loaded. */
  floodSource: string | null;
  /** True when the stream query answered (found or empty — both are answers). */
  streamsAnswered: boolean;
  /** Stream source string (USGS NHD) when answered. */
  streamsSource: string | null;
  /** When the stream source was checked (ISO), when answered. */
  streamsCheckedAt: string | null;
  /** True when the parcel outline came from an imported GeoJSON file. */
  parcelImported: boolean;
  /** Imported outline file name, when imported. */
  parcelImportName: string | null;
  /** Development cost lines carrying a source note. */
  costLinesWithSource: number;
  /** Development cost lines in total. */
  costLinesTotal: number;
  /** True when a sewer depth was entered. */
  sewerDepthEntered: boolean;
  /** Painted decision-class zones. */
  decisionZonesPainted: number;
}

export function feasibilityAuditStatus(f: FeasibilityAuditFacts): AuditStatusRow[] {
  const rows: AuditStatusRow[] = [];

  rows.push(
    f.terrainSource
      ? {
          factor: 'Ground heights (terrain)',
          status: 'verified',
          detail: `Pulled for this run from ${f.terrainSource}.`,
        }
      : {
          factor: 'Ground heights (terrain)',
          status: 'contractor_entered',
          detail: 'Corner heights entered by hand. Pull ground data to use USGS heights instead.',
        },
  );

  rows.push(
    f.floodZone && f.floodSource
      ? {
          factor: 'Flood zone',
          status: 'verified',
          detail: `Zone ${f.floodZone} from ${f.floodSource}.`,
        }
      : {
          factor: 'Flood zone',
          status: 'missing',
          detail: 'No flood data loaded for this run. Pull ground data, or confirm the zone on FEMA maps.',
        },
  );

  rows.push(
    f.streamsAnswered && f.streamsSource
      ? {
          factor: 'Streams & crossings',
          status: 'verified',
          detail: `Checked against ${f.streamsSource}${f.streamsCheckedAt ? ` on ${f.streamsCheckedAt.slice(0, 10)}` : ''}. Crossings still need a surveyor/engineer to confirm.`,
        }
      : {
          factor: 'Streams & crossings',
          status: 'missing',
          detail: 'Stream data has not been pulled for this run.',
        },
  );

  rows.push({
    factor: 'Parcel outline & dimensions',
    status: 'contractor_entered',
    detail: f.parcelImported
      ? `Imported outline (${f.parcelImportName ?? 'GeoJSON file'}) — your file, not a live source. Confirm against the survey.`
      : 'Dimensions entered by hand. Confirm against the survey.',
  });

  rows.push({
    factor: 'Zoning rules',
    status: 'contractor_entered',
    detail: 'Entered by hand — no public Texas bulk zoning source is connected.',
  });

  rows.push({
    factor: 'Land price',
    status: 'contractor_entered',
    detail: 'Your figure for this parcel.',
  });

  rows.push({
    factor: 'Development cost lines',
    status: 'contractor_entered',
    detail:
      f.costLinesTotal > 0
        ? `${f.costLinesWithSource} of ${f.costLinesTotal} lines carry a source note; the rest are your figures without one.`
        : 'No cost lines yet.',
  });

  rows.push({
    factor: 'Sale prices & revenue',
    status: 'contractor_entered',
    detail: 'Your figures. Field Pro publishes no sale prices.',
  });

  rows.push({
    factor: 'Comparable sales',
    status: 'missing',
    detail: 'No comparable-sales source is connected, so none are shown rather than invented.',
  });

  rows.push(
    f.sewerDepthEntered
      ? {
          factor: 'Sewer depth',
          status: 'contractor_entered',
          detail: 'Depth entered by hand; the trench check below is computed from it.',
        }
      : {
          factor: 'Sewer depth',
          status: 'missing',
          detail: 'Not entered — sitework carries no depth allowance.',
        },
  );

  rows.push({
    factor: 'Tree cover, HOA dues & timeline',
    status: 'contractor_entered',
    detail: 'Your figures for this deal.',
  });

  rows.push(
    f.decisionZonesPainted > 0
      ? {
          factor: 'Land decision classes',
          status: 'contractor_entered',
          detail: `${f.decisionZonesPainted} zone${f.decisionZonesPainted === 1 ? '' : 's'} painted — your judgment, not measured data.`,
        }
      : {
          factor: 'Land decision classes',
          status: 'missing',
          detail: 'None painted — optional judgment layer.',
        },
  );

  rows.push({
    factor: 'Slope, grading & trench depth',
    status: 'estimated',
    detail: 'Computed from the ground heights above — an estimate, not engineering.',
  });

  rows.push({
    factor: 'Lot layout & buildable area',
    status: 'estimated',
    detail: 'Planning layout from the entered rules and setbacks — not a survey or plat.',
  });

  rows.push({
    factor: 'Underwriting & scenario outputs',
    status: 'estimated',
    detail: 'Computed from the figures above (residential plans, farm, short-stay, commercial pad).',
  });

  return rows;
}
