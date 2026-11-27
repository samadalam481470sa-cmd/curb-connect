// Trade timing from OBSERVED permit sequences (finish-outs depth).
//
// A "sequence" is what the cities actually published at one address inside
// the scanned window: a finish-out / remodel / addition permit (the parent),
// followed by separate trade permits (electrical, plumbing, mechanical,
// roofing, finish) at the same normalized address. The lag between the
// parent permit's date and the first later permit of each trade is an
// observed fact about that address; aggregated across addresses it gives a
// per-trade timing window.
//
// Honest limits, carried into every response:
// - A window is only called "observed" when at least MIN_OBSERVED_SAMPLES
//   sequences support it. Below that the trade reports "insufficient data"
//   with the real sample count — no number is presented as a timing fact.
// - Permit dates are when the city recorded the permit, not when work
//   started. A lag is "days between permits at the same address", never a
//   construction schedule prediction.
// - Only permits inside the scanned window can form a sequence. A parent
//   whose trade permits fell outside the window contributes nothing, and a
//   missing trade permit never proves the trade is unawarded (finish trades
//   rarely pull their own permit — see finishOuts.ts).
import { TRADE_LABEL, type RawPermit } from './engine';
import { classifyRenovation, isFinishOutLead, RENOVATION_KIND_LABEL } from './finishOuts';
import { addressKey, OBSERVABLE_TRADES, permitTradeOf, type ObservableTrade } from './signals';

const DAY_MS = 86_400_000;

/** Sequences needed before a per-trade window may be called "observed". */
export const MIN_OBSERVED_SAMPLES = 5;

/** Caps so one response stays bounded on large scans. */
export const MAX_SEQUENCES = 50;
export const MAX_SEQUENCE_EVENTS = 12;

export interface TradeTimingWindow {
  trade: ObservableTrade;
  tradeLabel: string;
  /** 'observed' only at >= MIN_OBSERVED_SAMPLES sequences; else no numbers. */
  basis: 'observed' | 'insufficient_data';
  /** Observed parent→trade sequences behind this window. */
  samples: number;
  /** Median days from parent permit to first same-trade permit. Null when insufficient. */
  medianLagDays: number | null;
  minLagDays: number | null;
  maxLagDays: number | null;
  note: string;
}

export interface SequenceEvent {
  permitNumber: string;
  /** Renovation kind label for parents; trade label for trade permits. */
  label: string;
  isParent: boolean;
  /** Published permit date used for ordering (applied, else issued). */
  date: string;
}

export interface AddressSequence {
  address: string;
  city: string;
  sourceName: string;
  events: SequenceEvent[];
}

export interface TradeTimingReport {
  windows: TradeTimingWindow[];
  sequences: AddressSequence[];
  /** Addresses with a parent permit plus at least one later trade permit. */
  addressesWithSequences: number;
  /** Finish-out parent permits considered (with a usable date and address). */
  parentsConsidered: number;
  caveats: string[];
}

function permitDate(p: RawPermit): number | null {
  const raw = p.appliedAt ?? p.issuedAt;
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 10) / 10;
}

/**
 * Derive per-trade timing windows and address sequences from scanned
 * permits. Pure: callers supply the permits (the same scan the finish-outs
 * search already fetched).
 */
export function deriveTradeTiming(permits: readonly RawPermit[], _now: Date): TradeTimingReport {
  // Group dated permits by normalized address.
  const byAddress = new Map<string, { permit: RawPermit; date: number }[]>();
  for (const p of permits) {
    const key = addressKey(p);
    if (!key) continue;
    const date = permitDate(p);
    if (date === null) continue;
    const list = byAddress.get(key) ?? [];
    list.push({ permit: p, date });
    byAddress.set(key, list);
  }

  const lags = new Map<ObservableTrade, number[]>();
  for (const trade of OBSERVABLE_TRADES) lags.set(trade, []);
  const sequences: AddressSequence[] = [];
  let parentsConsidered = 0;

  for (const entries of byAddress.values()) {
    entries.sort((a, b) => a.date - b.date || a.permit.permitNumber.localeCompare(b.permit.permitNumber));
    const parents = entries.filter((e) => isFinishOutLead(e.permit));
    if (parents.length === 0) continue;
    parentsConsidered += parents.length;

    // One lag per (parent, trade): days to the FIRST later permit of that trade.
    for (const parent of parents) {
      for (const trade of OBSERVABLE_TRADES) {
        const first = entries.find(
          (e) =>
            e.permit !== parent.permit &&
            e.date >= parent.date &&
            permitTradeOf(e.permit) === trade,
        );
        if (first) {
          lags.get(trade)!.push(Math.round((first.date - parent.date) / DAY_MS));
        }
      }
    }

    // Sequence view: addresses where at least one trade permit follows a parent.
    const hasTradeAfterParent = entries.some(
      (e) =>
        permitTradeOf(e.permit) !== null &&
        parents.some((parent) => e.permit !== parent.permit && e.date >= parent.date),
    );
    if (hasTradeAfterParent && sequences.length < MAX_SEQUENCES) {
      const first = entries[0]!.permit;
      sequences.push({
        address: first.address,
        city: first.city,
        sourceName: first.sourceName,
        events: entries.slice(0, MAX_SEQUENCE_EVENTS).map((e) => {
          const trade = permitTradeOf(e.permit);
          const isParent = isFinishOutLead(e.permit);
          return {
            permitNumber: e.permit.permitNumber,
            label: isParent
              ? RENOVATION_KIND_LABEL[classifyRenovation(e.permit)]
              : trade
                ? TRADE_LABEL[trade]
                : e.permit.permitType || 'Permit',
            isParent,
            date: new Date(e.date).toISOString(),
          };
        }),
      });
    }
  }

  const windows: TradeTimingWindow[] = OBSERVABLE_TRADES.map((trade) => {
    const samples = [...lags.get(trade)!].sort((a, b) => a - b);
    if (samples.length < MIN_OBSERVED_SAMPLES) {
      return {
        trade,
        tradeLabel: TRADE_LABEL[trade],
        basis: 'insufficient_data' as const,
        samples: samples.length,
        medianLagDays: null,
        minLagDays: null,
        maxLagDays: null,
        note:
          samples.length === 0
            ? 'No parent→trade permit sequence observed in this scan yet — insufficient data, no timing claimed.'
            : `Only ${samples.length} observed sequence${samples.length === 1 ? '' : 's'} in this scan (need ${MIN_OBSERVED_SAMPLES}) — insufficient data, no timing claimed.`,
      };
    }
    return {
      trade,
      tradeLabel: TRADE_LABEL[trade],
      basis: 'observed' as const,
      samples: samples.length,
      medianLagDays: median(samples),
      minLagDays: samples[0]!,
      maxLagDays: samples[samples.length - 1]!,
      note: `Observed: days from the finish-out/remodel permit to the first ${TRADE_LABEL[trade].toLowerCase()} permit at the same address, across ${samples.length} sequences in this scan. Permit dates are not construction start dates.`,
    };
  });

  return {
    windows,
    sequences,
    addressesWithSequences: sequences.length,
    parentsConsidered,
    caveats: [
      'Trade timing is computed only from permit sequences the cities actually published inside this scan window (parent finish-out/remodel permit, then a later trade permit at the same address). A trade shows a timing window only with at least ' +
        `${MIN_OBSERVED_SAMPLES} observed sequences; below that it says "insufficient data" and claims no timing.`,
      'A lag is days between permit dates at the same address — not a construction schedule, and not a prediction for any single job. A missing trade permit never proves the trade is unawarded: finish trades rarely pull a permit of their own.',
    ],
  };
}
