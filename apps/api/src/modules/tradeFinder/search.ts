// Trade Finder matching logic (blueprint gap 6). Pure logic, no I/O.
// Searches run over published directory data (opted-in companies) and the
// org's own vendor records. Service areas are entered city/ZIP lists; ZIP
// "area" matching uses the first three digits (the USPS sectional center) —
// an approximation labeled as such, never presented as a true radius.

export type ExpiryStatus = 'not_on_file' | 'expired' | 'expiring_soon' | 'current';

/** Qualification status from an entered expiry date vs today (ISO dates). */
export function expiryStatus(expiresOn: string | null, todayIso: string, soonDays = 30): ExpiryStatus {
  if (!expiresOn) return 'not_on_file';
  const exp = Date.parse(`${expiresOn}T00:00:00Z`);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(exp) || Number.isNaN(today)) return 'not_on_file';
  if (exp < today) return 'expired';
  const days = Math.floor((exp - today) / 86_400_000);
  return days <= soonDays ? 'expiring_soon' : 'current';
}

const norm = (s: string) => s.trim().toLowerCase();

export interface TradeSearchFilters {
  trade?: string;
  city?: string;
  zip?: string;
  /** When true, ZIP matches the same 3-digit sectional area instead of exact ZIP. */
  zipArea?: boolean;
  availability?: string;
  /** Only include results whose license AND insurance are on file and not expired. */
  qualifiedOnly?: boolean;
}

export interface TradeCandidate {
  trades: readonly string[];
  serviceCities: readonly string[];
  serviceZips: readonly string[];
  availability: string | null;
  licenseStatus: ExpiryStatus;
  insuranceStatus: ExpiryStatus;
}

export function matchesFilters(candidate: TradeCandidate, filters: TradeSearchFilters): boolean {
  if (filters.trade) {
    const wanted = norm(filters.trade);
    if (!candidate.trades.some((t) => norm(t) === wanted || norm(t).includes(wanted))) return false;
  }
  if (filters.city) {
    const wanted = norm(filters.city);
    if (!candidate.serviceCities.some((c) => norm(c) === wanted || norm(c).includes(wanted))) return false;
  }
  if (filters.zip) {
    const wanted = filters.zip.trim();
    const ok = filters.zipArea
      ? candidate.serviceZips.some((z) => z.trim().slice(0, 3) === wanted.slice(0, 3))
      : candidate.serviceZips.some((z) => z.trim() === wanted);
    if (!ok) return false;
  }
  if (filters.availability) {
    if ((candidate.availability ?? '') !== filters.availability) return false;
  }
  if (filters.qualifiedOnly) {
    const okStatus = (s: ExpiryStatus) => s === 'current' || s === 'expiring_soon';
    if (!okStatus(candidate.licenseStatus) || !okStatus(candidate.insuranceStatus)) return false;
  }
  return true;
}
