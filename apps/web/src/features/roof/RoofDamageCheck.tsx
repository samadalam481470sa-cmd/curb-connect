'use client';

// "Take picture of damage": opens the camera on phones, downsizes the photo in the browser, and asks
// the server for a visual damage check. Cost is only computed from the roofer's own measured area and
// rate; the photo never sets a price. Results are observations to confirm on site.
import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { z } from 'zod';
import { errorHint } from '../../lib/api';
import { useApi } from '../../lib/session';

const Finding = z.object({
  type: z.string(),
  severity: z.enum(['minor', 'moderate', 'severe']),
  location: z.string(),
  description: z.string(),
  confidence: z.number(),
  suggestedRepair: z.string(),
});
const DamageResponse = z.object({
  report: z.object({
    imageQuality: z.enum(['good', 'poor', 'unusable']),
    overallCondition: z.enum(['no_visible_damage', 'minor', 'moderate', 'severe', 'unable_to_assess']),
    findings: z.array(Finding),
    limitations: z.array(z.string()),
  }),
  cost: z
    .object({
      repairAreaSqFt: z.number(),
      subtotalCents: z.number(),
      contingencyCents: z.number(),
      totalCents: z.number(),
      basis: z.string(),
    })
    .nullable(),
  disclaimer: z.string(),
});

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const MAX_EDGE_PX = 1600;

/** Downscale to a JPEG so phone photos stay under the server limit. */
export async function photoToJpegBase64(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('That file is not a photo this browser can read.'));
      el.src = url;
    });
    const scale = Math.min(1, MAX_EDGE_PX / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare the photo.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return dataUrl.slice(dataUrl.indexOf(',') + 1);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function RoofDamageCheck() {
  const { api } = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [area, setArea] = useState('');
  const [rate, setRate] = useState('');
  const [preparing, setPreparing] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);

  const analyze = useMutation({
    mutationFn: (): Promise<z.output<typeof DamageResponse>> => {
      const body: Record<string, unknown> = { mediaType: 'image/jpeg', imageBase64: base64 };
      const a = Number(area);
      const r = Number(rate);
      if (area && rate && a > 0 && r > 0) {
        body.repairAreaSqFt = a;
        body.ratePerSqFtCents = Math.round(r * 100);
      }
      return api.post('/v1/roof/damage-analysis', body, { schema: DamageResponse });
    },
  });

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPrepError(null);
    analyze.reset();
    setPreparing(true);
    try {
      const data = await photoToJpegBase64(file);
      setBase64(data);
      setPreview(`data:image/jpeg;base64,${data}`);
    } catch (err) {
      setBase64(null);
      setPreview(null);
      setPrepError(err instanceof Error ? err.message : 'Could not read that photo.');
    } finally {
      setPreparing(false);
    }
  }

  const result = analyze.data;
  const areaNumber = Number(area);
  const rateNumber = Number(rate);
  const costInputsInvalid = (area !== '' && !(areaNumber > 0)) || (rate !== '' && !(rateNumber > 0));

  return (
    <section aria-labelledby="damage-check-title" className="roof-damage-check" style={{ display: 'grid', gap: 12 }}>
      <h2 id="damage-check-title" style={{ margin: 0, fontSize: 18 }}>Roof damage check</h2>
      <p style={{ margin: 0, fontSize: 14 }}>
        Take a photo of the damage. The check lists visible roofing defects. It cannot see under the
        shingles or in the decking, so confirm on site.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/*"
        capture="environment"
        hidden
        aria-label="Photo of roof damage"
        onChange={(e) => void onPhoto(e.target.files?.[0])}
      />
      <button type="button" className="cc-btn" onClick={() => inputRef.current?.click()} disabled={preparing || analyze.isPending}>
        {preparing ? 'Preparing photo…' : 'Take picture of damage'}
      </button>
      {prepError && <p role="alert">{prepError}</p>}

      {preview && (
        <div style={{ display: 'grid', gap: 10, maxWidth: 480 }}>
          <img src={preview} alt="Selected roof photo" style={{ width: '100%', borderRadius: 8 }} />

          <fieldset style={{ display: 'grid', gap: 8, border: 0, padding: 0 }}>
            <legend style={{ fontSize: 14, marginBottom: 4 }}>Optional: cost from your measurement</legend>
            <label style={{ display: 'grid', gap: 4 }}>
              Repair area you measured (sq ft)
              <input inputMode="decimal" value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. 250" />
            </label>
            <label style={{ display: 'grid', gap: 4 }}>
              Your installed rate ($ per sq ft)
              <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="e.g. 8.50" />
            </label>
            {costInputsInvalid && <p role="alert" style={{ margin: 0 }}>Enter numbers greater than zero, or leave both blank.</p>}
          </fieldset>

          <button
            type="button"
            className="cc-btn"
            onClick={() => analyze.mutate()}
            disabled={!base64 || analyze.isPending || costInputsInvalid}
          >
            {analyze.isPending ? 'Checking photo…' : 'Check this damage'}
          </button>
        </div>
      )}

      {analyze.isError && <p role="alert">{errorHint(analyze.error)}</p>}

      {result && (
        <article aria-live="polite" style={{ display: 'grid', gap: 10 }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>
            Overall: {result.report.overallCondition.replace(/_/g, ' ')} · photo {result.report.imageQuality}
          </h3>
          {result.report.findings.length === 0 ? (
            <p style={{ margin: 0 }}>No roofing defects were reported in this photo.</p>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 8 }}>
              {result.report.findings.map((f, i) => (
                <li key={`${f.type}-${i}`}>
                  <strong>{f.type.replace(/_/g, ' ')}</strong> ({f.severity}, {Math.round(f.confidence * 100)}% confidence)
                  <div>{f.location}: {f.description}</div>
                  <div style={{ fontSize: 13 }}>Suggested: {f.suggestedRepair}</div>
                </li>
              ))}
            </ul>
          )}
          {result.report.limitations.length > 0 && (
            <div style={{ fontSize: 13 }}>Limits: {result.report.limitations.join(' ')}</div>
          )}
          {result.cost ? (
            <div style={{ borderTop: '1px solid var(--border, #ddd)', paddingTop: 8 }}>
              <strong>Estimated repair: {usd.format(result.cost.totalCents / 100)}</strong>
              <div style={{ fontSize: 13 }}>{result.cost.basis}</div>
            </div>
          ) : (
            <p style={{ margin: 0, fontSize: 13 }}>
              Enter your measured area and rate above to get a repair cost. The photo alone cannot set a price.
            </p>
          )}
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted, #555)' }}>{result.disclaimer}</p>
        </article>
      )}
    </section>
  );
}
