// Portal house link (connectivity build 7): a homeowner's job-status link resolves the
// sales contract through the land house when one exists (land_houses.contract_id), so the
// portal shows the right home even when the contract row was never stamped with the job
// id. Pure helpers here; the portal module does the queries.

/** Which contract id wins: the land house's linked contract first, then the direct one. */
export function pickPortalContractId(
  houseContractId: string | null | undefined,
  directContractId: string | null | undefined,
): string | null {
  return houseContractId ?? directContractId ?? null;
}

/** Plan spec summary read defensively from a House Studio spec blob (never invented). */
export function planSpecSummary(spec: unknown) {
  const s = (spec ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const int = (v: unknown) => {
    const n = num(v);
    return n === null ? null : Math.trunc(n);
  };
  return {
    bedrooms: int(s.bedrooms),
    bathrooms: int(s.bathrooms),
    stories: int(s.stories),
    garage: typeof s.garage === 'string' ? s.garage : null,
    lengthFt: num(s.lengthFt),
    widthFt: num(s.widthFt),
    roofPitch: num(s.roofPitch),
  };
}
