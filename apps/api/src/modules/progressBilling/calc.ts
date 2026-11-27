// Progress-billing math (blueprint gap 2): schedule-of-values applications.
// Pure logic, no I/O. All money is integer minor units; percentages and the
// retainage rate are contractor-entered — nothing is invented here.
//
// Per line: completed-to-date = round(scheduled value x % complete / 100).
// Stored materials are billed on top of completed work (entered per line).
// This period = (completed + stored to date) - (completed + stored previously
// billed). Retainage is withheld at the contract rate on completed+stored;
// the amount due this period is this-period gross minus the retainage
// withheld this period. Balance to finish = scheduled - completed - stored.

export interface SovLineForCalc {
  id: string;
  scheduledValueMinor: number;
}

export interface ApplicationLineForCalc {
  sovLineId: string;
  /** 0..100, contractor-entered. */
  percentComplete: number;
  storedMaterialsMinor: number;
}

export interface PreviousBillingForCalc {
  /** Completed + stored billed on prior approved applications, per SOV line. */
  completedStoredByLine: ReadonlyMap<string, number>;
  /** Total retainage withheld on prior approved applications. */
  retainageWithheldMinor: number;
}

export interface ComputedLine {
  sovLineId: string;
  scheduledValueMinor: number;
  percentComplete: number;
  completedToDateMinor: number;
  storedMaterialsMinor: number;
  completedStoredToDateMinor: number;
  previousCompletedStoredMinor: number;
  thisPeriodMinor: number;
  balanceToFinishMinor: number;
  overbilled: boolean;
}

export interface ComputedApplication {
  lines: ComputedLine[];
  scheduledTotalMinor: number;
  completedStoredTotalMinor: number;
  previousCompletedStoredMinor: number;
  thisPeriodGrossMinor: number;
  retainageToDateMinor: number;
  retainageThisPeriodMinor: number;
  currentDueMinor: number;
  balanceToFinishMinor: number;
  /** True when any line bills more than its scheduled value. */
  overbilled: boolean;
}

const roundMinor = (n: number) => Math.round(n);

export function computeApplication(
  sovLines: readonly SovLineForCalc[],
  applicationLines: readonly ApplicationLineForCalc[],
  previous: PreviousBillingForCalc,
  retainagePct: number,
): ComputedApplication {
  const inputByLine = new Map(applicationLines.map((l) => [l.sovLineId, l]));
  const lines: ComputedLine[] = sovLines.map((sov) => {
    const input = inputByLine.get(sov.id);
    const percentComplete = input ? Math.min(100, Math.max(0, input.percentComplete)) : 0;
    const storedMaterialsMinor = input ? Math.max(0, input.storedMaterialsMinor) : 0;
    const completedToDateMinor = roundMinor((sov.scheduledValueMinor * percentComplete) / 100);
    const completedStoredToDateMinor = completedToDateMinor + storedMaterialsMinor;
    const previousCompletedStoredMinor = previous.completedStoredByLine.get(sov.id) ?? 0;
    const thisPeriodMinor = completedStoredToDateMinor - previousCompletedStoredMinor;
    const balanceToFinishMinor = sov.scheduledValueMinor - completedStoredToDateMinor;
    return {
      sovLineId: sov.id,
      scheduledValueMinor: sov.scheduledValueMinor,
      percentComplete,
      completedToDateMinor,
      storedMaterialsMinor,
      completedStoredToDateMinor,
      previousCompletedStoredMinor,
      thisPeriodMinor,
      balanceToFinishMinor,
      overbilled: completedStoredToDateMinor > sov.scheduledValueMinor,
    };
  });

  const scheduledTotalMinor = lines.reduce((s, l) => s + l.scheduledValueMinor, 0);
  const completedStoredTotalMinor = lines.reduce((s, l) => s + l.completedStoredToDateMinor, 0);
  const previousCompletedStoredMinor = lines.reduce((s, l) => s + l.previousCompletedStoredMinor, 0);
  const thisPeriodGrossMinor = completedStoredTotalMinor - previousCompletedStoredMinor;
  const pct = Math.min(100, Math.max(0, retainagePct));
  const retainageToDateMinor = roundMinor((completedStoredTotalMinor * pct) / 100);
  const retainageThisPeriodMinor = retainageToDateMinor - previous.retainageWithheldMinor;
  return {
    lines,
    scheduledTotalMinor,
    completedStoredTotalMinor,
    previousCompletedStoredMinor,
    thisPeriodGrossMinor,
    retainageToDateMinor,
    retainageThisPeriodMinor,
    currentDueMinor: thisPeriodGrossMinor - retainageThisPeriodMinor,
    balanceToFinishMinor: scheduledTotalMinor - completedStoredTotalMinor,
    overbilled: lines.some((l) => l.overbilled),
  };
}

/** Validate raw application line inputs before computing. Returns an error string or null. */
export function validateApplicationLines(
  sovLines: readonly SovLineForCalc[],
  applicationLines: readonly ApplicationLineForCalc[],
): string | null {
  const known = new Set(sovLines.map((l) => l.id));
  for (const line of applicationLines) {
    if (!known.has(line.sovLineId)) return 'An application line does not belong to this schedule of values.';
    if (!Number.isFinite(line.percentComplete) || line.percentComplete < 0 || line.percentComplete > 100) {
      return 'Percent complete must be between 0 and 100.';
    }
    if (!Number.isInteger(line.storedMaterialsMinor) || line.storedMaterialsMinor < 0) {
      return 'Stored materials must be a non-negative amount.';
    }
  }
  return null;
}
