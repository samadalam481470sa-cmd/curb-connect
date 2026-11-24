'use client';

// "AI build a house": describe the house (and what you already have: budget, lot, materials) or
// upload a plan sheet. The server reads it (typed text and CAD PDFs without AI; photos and scans
// with AI when it is set up), asks about anything missing, and the 3D model, takeoff and costs
// rebuild from the result. Every build is saved to "My houses" so it can be managed or deleted.
import {
  HOUSE_PLAN_MEDIA_TYPES,
  type HouseBriefResponse,
  HouseBriefResponseSchema,
  type HouseBriefSpec,
} from '@fieldline/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import { errorHint } from '../../lib/api';
import { useApi } from '../../lib/session';
import { PlanReadingTable } from './PlanReadingTable';
import { runHouseCommand } from './houseCommands';
import { LOCAL_MODEL_LABEL, localModelSupported, requestToCommands } from './localModel';
import type { StudioCostSettings } from './studioCost';
import type { BuildSpec } from './takeoff';

const MAX_BYTES = 8 * 1024 * 1024;

type PlanFile = { name: string; mediaType: (typeof HOUSE_PLAN_MEDIA_TYPES)[number]; data: string };

const READING_LABEL: Record<NonNullable<HouseBriefResponse['reading']>, string> = {
  text: 'read from your description',
  pdf_text: 'read from the plan file’s text (no AI needed)',
  pdf_geometry: 'measured from the plan’s drawn lines (no AI needed)',
  ai: 'read by AI',
  pdf_text_and_ai: 'read by AI with the plan file’s text',
};

const ON_HAND_LABEL: Record<string, string> = {
  stud_2x4: '2x4 studs',
  lumber_2x6: '2x6 lumber',
  osb_sheet: 'OSB / plywood sheets',
  drywall_sheet: 'drywall sheets',
  shingle_bundle: 'shingle bundles',
  roof_truss: 'roof trusses',
  window: 'windows',
  exterior_door: 'exterior doors',
  interior_door: 'interior doors',
  insulation: 'insulation',
  concrete_yd3: 'cubic yards of concrete',
  rebar: 'rebar',
};

export function AiHouseBrief({
  onSpec,
  onResult,
  spec,
  costs,
  onCommandSpec,
  onUndo,
}: {
  onSpec: (spec: HouseBriefSpec) => void;
  /** Called after a successful read with the brief text, for saving the house. */
  onResult?: (result: HouseBriefResponse, brief: { text: string; fileName: string | null }) => void;
  /** The current house and cost settings, so plain commands run in the browser at once. */
  spec?: BuildSpec;
  costs?: StudioCostSettings;
  /** Replaces the whole house (commands); undo goes back one step. */
  onCommandSpec?: (spec: BuildSpec) => void;
  onUndo?: () => boolean;
}) {
  const { api } = useApi();
  const [text, setText] = useState('');
  const [file, setFile] = useState<PlanFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [thinking, setThinking] = useState<string | null>(null);

  /** Plain commands ("2400 sqft", "add a bath", "make it cheaper") run here, on this computer. */
  function submit() {
    setSaid(null);
    if (!file && spec && costs && onCommandSpec) {
      const r = runHouseCommand(text, spec, costs);
      if (r.kind === 'undo') {
        setSaid(onUndo?.() ? 'Went back one step.' : 'Nothing to undo.');
        return;
      }
      if (r.kind === 'spec') {
        run.reset();
        onCommandSpec(r.spec);
        setSaid(r.said);
        setText('');
        return;
      }
      if (text.trim() && localModelSupported()) {
        void askLocal(text, spec, costs, onCommandSpec);
        return;
      }
    }
    run.mutate({ text, file });
  }

  /** Open-ended requests: the open Qwen model on this computer rewrites them into commands. */
  async function askLocal(
    request: string,
    start: BuildSpec,
    settings: StudioCostSettings,
    apply: (spec: BuildSpec) => void,
  ) {
    setThinking('Thinking with ' + LOCAL_MODEL_LABEL + '…');
    try {
      const commands = await requestToCommands(request, (t, f) =>
        setThinking(
          f < 1
            ? `Getting the free AI ready on this computer (first time only): ${Math.round(f * 100)}%`
            : t,
        ),
      );
      let next = start;
      const done: string[] = [];
      for (const c of commands ?? []) {
        const r = runHouseCommand(c, next, settings);
        if (r.kind === 'spec') {
          next = r.spec;
          done.push(r.said);
        }
      }
      setThinking(null);
      if (done.length) {
        run.reset();
        apply(next);
        setSaid(
          `AI on this computer read that as: ${(commands ?? []).join('; ')}. ${done.join(' ')}`,
        );
        setText('');
        return;
      }
    } catch {
      setThinking(null);
    }
    // Nothing the house commands could use: let the server reader try.
    run.mutate({ text: request, file: null });
  }

  const run = useMutation({
    mutationFn: (input: { text: string; file: PlanFile | null }) =>
      api.post(
        '/v1/home/brief',
        {
          ...(input.text.trim() ? { text: input.text.trim() } : {}),
          ...(input.file
            ? { file: { mediaType: input.file.mediaType, data: input.file.data } }
            : {}),
        },
        { schema: HouseBriefResponseSchema },
      ),
    onSuccess: (result, input) => {
      onSpec(result.spec);
      onResult?.(result, { text: input.text.trim(), fileName: input.file?.name ?? null });
    },
  });

  function answer(option: string) {
    const next = text.trim() ? `${text.trim().replace(/[.,;]$/, '')}, ${option}` : option;
    setText(next);
    run.mutate({ text: next, file });
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    setFileError(null);
    if (!f) return;
    // Browsers report DXF and DWG with different or empty types, so the file name decides for them.
    const lower = f.name.toLowerCase();
    const type: PlanFile['mediaType'] | null = lower.endsWith('.dxf')
      ? 'application/dxf'
      : lower.endsWith('.dwg')
        ? 'image/vnd.dwg'
        : (HOUSE_PLAN_MEDIA_TYPES as readonly string[]).includes(f.type)
        ? (f.type as PlanFile['mediaType'])
        : null;
    if (!type) {
      setFileError('Upload a plan as an AutoCAD DWG or DXF, a PDF, or a PNG, JPG or WebP image.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError(
        'That file is larger than 8 MB. Export the plan page alone, or a smaller image.',
      );
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      setFile({ name: f.name, mediaType: type, data: url.slice(url.indexOf(',') + 1) });
    };
    reader.readAsDataURL(f);
  }

  const data = run.data;
  return (
    <section className="hs-ai" aria-label="AI build a house">
      <div className="hs-ai-head">
        <strong>AI build a house</strong>
        <span>
          Say what you want and what you have, for example budget, lot size or materials on hand. Or
          upload a plan. The 3D model, takeoff and costs rebuild from it, and the house is saved to
          My houses.
        </span>
      </div>
      <div className="hs-ai-row">
        <textarea
          rows={2}
          maxLength={2000}
          value={text}
          placeholder="Type 2400 sqft, add a bath, roof 8/12, make it cheaper, undo — or describe the house: 60x120 lot, $350k budget, 4 bed 3 bath"
          aria-label="Describe the house"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && (text.trim() || file) && !run.isPending) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="hs-ai-actions">
          <label className="hs-pill hs-file">
            {file ? `Plan: ${file.name.slice(0, 24)}` : 'Upload plan (AutoCAD DWG or DXF, PDF or image)'}
            <input
              type="file"
              accept={`${HOUSE_PLAN_MEDIA_TYPES.join(',')},.dxf,.dwg`}
              hidden
              onChange={onFile}
            />
          </label>
          {file && (
            <button type="button" className="hs-pill" onClick={() => setFile(null)}>
              Remove plan
            </button>
          )}
          <button
            type="button"
            className="hs-pill is-on hs-build"
            disabled={(!text.trim() && !file) || run.isPending || !!thinking}
            onClick={submit}
          >
            {run.isPending ? 'Reading…' : 'Build it'}
          </button>
        </div>
      </div>
      {fileError && (
        <p className="hs-ai-error" role="alert">
          {fileError}
        </p>
      )}
      {run.error && (
        <p className="hs-ai-error" role="alert">
          {errorHint(run.error)}
        </p>
      )}
      {thinking && (
        <p className="hs-ai-said" role="status">
          {thinking}
        </p>
      )}
      {said && (
        <p className="hs-ai-said" role="status">
          {said}
        </p>
      )}
      {data && (
        <div className="hs-ai-result" role="status">
          <p>
            Built a {data.spec.stories}-story, {data.spec.bedrooms} bed / {data.spec.bathrooms} bath
            house, {data.spec.lengthFt} × {data.spec.widthFt} ft,{' '}
            {data.spec.garage === 'none'
              ? 'no garage'
              : data.spec.garage === 'one_car'
                ? '1-car garage'
                : '2-car garage'}
            , {data.spec.wallHeightFt} ft walls, {data.spec.roofPitch}/12 roof
            {data.reading ? ` (${READING_LABEL[data.reading]}).` : '.'}
          </p>
          {(data.budgetCents || data.lot || (data.onHand?.length ?? 0) > 0) && (
            <p className="hs-ai-extras">
              {data.budgetCents ? (
                <span>Budget ${Math.round(data.budgetCents / 100).toLocaleString('en-US')}</span>
              ) : null}
              {data.lot ? (
                <span>
                  Lot {data.lot.widthFt} × {data.lot.depthFt} ft
                </span>
              ) : null}
              {data.onHand?.map((h) => (
                <span key={h.item}>
                  Have {h.quantity.toLocaleString('en-US')} {ON_HAND_LABEL[h.item] ?? h.item}
                </span>
              ))}
            </p>
          )}
          {data.notes.length > 0 && (
            <ul>
              {data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {data.plan && (
            <PlanReadingTable
              key={JSON.stringify(data.spec)}
              reading={data.plan}
              spec={data.spec}
              onApply={onSpec}
            />
          )}
          {(data.questions?.length ?? 0) > 0 && (
            <div className="hs-ai-questions" role="region" aria-label="Questions to firm up the estimate">
              {data.questions!.map((q) => (
                <div key={q.field} className="hs-ai-q">
                  <span>{q.question}</span>
                  <div className="hs-ai-chips">
                    {q.options.map((o) => (
                      <button
                        key={o}
                        type="button"
                        className="hs-pill"
                        disabled={run.isPending}
                        onClick={() => answer(o)}
                      >
                        {o}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
