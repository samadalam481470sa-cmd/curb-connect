// Concrete dispatch logic (blueprint gap 5). Pure logic, no I/O: the status
// flow for orders/loads and the delivered-yards invoice math. Prices are the
// contractor-entered mix-design price per yard — never invented.

export type ConcreteStatus =
  | 'scheduled'
  | 'batched'
  | 'en_route'
  | 'on_site'
  | 'pouring'
  | 'complete'
  | 'cancelled';

const FLOW: Record<ConcreteStatus, ConcreteStatus[]> = {
  scheduled: ['batched', 'cancelled'],
  batched: ['en_route', 'cancelled'],
  en_route: ['on_site'],
  on_site: ['pouring'],
  pouring: ['complete'],
  complete: [],
  cancelled: [],
};

export function canTransition(from: ConcreteStatus, to: ConcreteStatus): boolean {
  return FLOW[from].includes(to);
}

export function nextStatuses(from: ConcreteStatus): ConcreteStatus[] {
  return [...FLOW[from]];
}

export interface LoadForTotals {
  status: ConcreteStatus;
  yardsLoaded: number | null;
  yardsDelivered: number | null;
  yardsReturned: number | null;
}

export interface LoadTotals {
  loadCount: number;
  completedLoads: number;
  yardsLoaded: number;
  yardsDelivered: number;
  yardsReturned: number;
  /** Delivered yards on completed loads only — what gets billed. */
  billableYards: number;
}

export function loadTotals(loads: readonly LoadForTotals[]): LoadTotals {
  let yardsLoaded = 0;
  let yardsDelivered = 0;
  let yardsReturned = 0;
  let billableYards = 0;
  let completedLoads = 0;
  for (const l of loads) {
    yardsLoaded += l.yardsLoaded ?? 0;
    yardsDelivered += l.yardsDelivered ?? 0;
    yardsReturned += l.yardsReturned ?? 0;
    if (l.status === 'complete') {
      completedLoads += 1;
      billableYards += l.yardsDelivered ?? 0;
    }
  }
  return { loadCount: loads.length, completedLoads, yardsLoaded, yardsDelivered, yardsReturned, billableYards };
}

/**
 * Invoice amount for delivered concrete: billable yards × entered price per
 * yard. Returns null when the mix has no entered price (never invented).
 */
export function invoiceAmountMinor(billableYards: number, pricePerYardMinor: number | null): number | null {
  if (pricePerYardMinor === null) return null;
  if (!(billableYards > 0)) return 0;
  return Math.round(billableYards * pricePerYardMinor);
}
