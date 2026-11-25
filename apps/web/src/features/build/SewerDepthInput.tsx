// Sewer depth: contractor-entered depth and extra cost per foot of depth, per linear foot
// of main. Self-contained: it only reports what the builder typed, via onChange. Blank (or
// 0) depth or rate means no effect — runFeasibility adds no cost row and no cost. The extra
// sitework cost is depth x rate x main length; the hint below shows it when the main length
// is known. Every figure is an estimate from contractor-entered inputs.
import { useState } from 'react';

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export function SewerDepthInput({
  depthFt,
  extraCostPerFtPerLf,
  onChange,
  mainLengthFt,
}: {
  /** Sewer depth in feet; 0 = not entered. */
  depthFt: number;
  /** Extra cost per foot of depth, per linear foot of main ($/ft/lf); 0 = not entered. */
  extraCostPerFtPerLf: number;
  onChange: (patch: { depthFt: number; extraCostPerFtPerLf: number }) => void;
  /** Length of main the depth applies to, when the current run has one. */
  mainLengthFt?: number;
}) {
  // Text state so the field can sit blank while typing (blank reads as 0, i.e. no effect).
  // Follow a changed prop while rendering, as React recommends, instead of in an effect.
  const [depthText, setDepthText] = useState(String(depthFt));
  const [rateText, setRateText] = useState(String(extraCostPerFtPerLf));
  const [seenDepth, setSeenDepth] = useState(depthFt);
  if (depthFt !== seenDepth) {
    setSeenDepth(depthFt);
    setDepthText(String(depthFt));
  }
  const [seenRate, setSeenRate] = useState(extraCostPerFtPerLf);
  if (extraCostPerFtPerLf !== seenRate) {
    setSeenRate(extraCostPerFtPerLf);
    setRateText(String(extraCostPerFtPerLf));
  }

  const apply = (kind: 'depthFt' | 'extraCostPerFtPerLf', text: string) => {
    const n = text.trim() === '' ? 0 : Number(text);
    if (!Number.isFinite(n)) return;
    const value = Math.max(0, n);
    onChange(
      kind === 'depthFt'
        ? { depthFt: value, extraCostPerFtPerLf }
        : { depthFt, extraCostPerFtPerLf: value },
    );
  };

  const extra =
    depthFt > 0 && extraCostPerFtPerLf > 0 && (mainLengthFt ?? 0) > 0
      ? depthFt * extraCostPerFtPerLf * mainLengthFt!
      : 0;

  return (
    <div className="wb-card">
      <h3>Sewer depth</h3>
      <p className="wb-muted">
        How deep the sewer runs, and what each extra foot of depth costs per foot of main. Leave
        blank (or 0) when the depth is standard — it adds nothing. Estimates only, from figures
        you enter.
      </p>
      <div className="lf-fields">
        <label className="lf-field">
          <span>
            Sewer depth <em>(ft)</em>
          </span>
          <input
            className="wb-input"
            type="number"
            inputMode="decimal"
            step={0.5}
            min={0}
            value={depthText}
            aria-label="Sewer depth in feet"
            onChange={(e) => {
              setDepthText(e.target.value);
              apply('depthFt', e.target.value);
            }}
          />
        </label>
        <label className="lf-field">
          <span>
            Extra cost per foot of depth <em>($ / ft, per ft of main)</em>
          </span>
          <input
            className="wb-input"
            type="number"
            inputMode="decimal"
            step={0.5}
            min={0}
            value={rateText}
            aria-label="Extra cost per foot of sewer depth, per linear foot of main"
            onChange={(e) => {
              setRateText(e.target.value);
              apply('extraCostPerFtPerLf', e.target.value);
            }}
          />
        </label>
      </div>
      {extra > 0 && (
        <p className="wb-muted" role="status">
          Extra sewer depth (estimate): {money(extra)} over {Math.round(mainLengthFt!)} ft of
          main.
        </p>
      )}
    </div>
  );
}
