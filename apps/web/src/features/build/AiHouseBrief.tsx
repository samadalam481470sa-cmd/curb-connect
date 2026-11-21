'use client';

// "AI build a house": describe the house or upload a plan sheet (image or PDF) and the House
// Builder fills in the footprint, stories, rooms, garage, wall height and roof pitch. The 3D
// model, takeoff and costs then rebuild from that program.
import { HOUSE_PLAN_MEDIA_TYPES, HouseBriefResponseSchema, type HouseBriefSpec } from '@fieldline/contracts';
import { useMutation } from '@tanstack/react-query';
import { useState, type ChangeEvent } from 'react';
import { errorHint } from '../../lib/api';
import { useApi } from '../../lib/session';

const MAX_BYTES = 8 * 1024 * 1024;

export function AiHouseBrief({ onSpec }: { onSpec: (spec: HouseBriefSpec) => void }) {
  const { api } = useApi();
  const [text, setText] = useState('');
  const [file, setFile] = useState<{ name: string; mediaType: (typeof HOUSE_PLAN_MEDIA_TYPES)[number]; data: string } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () =>
      api.post(
        '/v1/home/brief',
        {
          ...(text.trim() ? { text: text.trim() } : {}),
          ...(file ? { file: { mediaType: file.mediaType, data: file.data } } : {}),
        },
        { schema: HouseBriefResponseSchema },
      ),
    onSuccess: (result) => onSpec(result.spec),
  });

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = '';
    setFileError(null);
    if (!f) return;
    const type = (HOUSE_PLAN_MEDIA_TYPES as readonly string[]).includes(f.type) ? (f.type as (typeof HOUSE_PLAN_MEDIA_TYPES)[number]) : null;
    if (!type) {
      setFileError('Upload a plan as a PNG, JPG, WebP or PDF file.');
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError('That file is larger than 8 MB. Export the plan page alone, or a smaller image.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? '');
      setFile({ name: f.name, mediaType: type, data: url.slice(url.indexOf(',') + 1) });
    };
    reader.readAsDataURL(f);
  }

  return (
    <section className="hs-ai" aria-label="AI build a house">
      <div className="hs-ai-head">
        <strong>AI build a house</strong>
        <span>Describe it or upload a plan. The 3D model, takeoff and costs rebuild from it.</span>
      </div>
      <div className="hs-ai-row">
        <textarea
          rows={2}
          maxLength={2000}
          value={text}
          placeholder="Example: 4 bed 3 bath two-story, about 2,600 sq ft, 2-car garage, 9 ft walls, 8/12 roof"
          aria-label="Describe the house"
          onChange={(e) => setText(e.target.value)}
        />
        <div className="hs-ai-actions">
          <label className="hs-pill hs-file">
            {file ? `Plan: ${file.name.slice(0, 24)}` : 'Upload plan (PDF or image)'}
            <input type="file" accept={HOUSE_PLAN_MEDIA_TYPES.join(',')} hidden onChange={onFile} />
          </label>
          {file && (
            <button type="button" className="hs-pill" onClick={() => setFile(null)}>
              Remove plan
            </button>
          )}
          <button
            type="button"
            className="hs-pill is-on hs-build"
            disabled={(!text.trim() && !file) || run.isPending}
            onClick={() => run.mutate()}
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
      {run.data && (
        <div className="hs-ai-result" role="status">
          <p>
            Built a {run.data.spec.stories}-story, {run.data.spec.bedrooms} bed / {run.data.spec.bathrooms} bath house,{' '}
            {run.data.spec.lengthFt} × {run.data.spec.widthFt} ft,{' '}
            {run.data.spec.garage === 'none' ? 'no garage' : run.data.spec.garage === 'one_car' ? '1-car garage' : '2-car garage'},{' '}
            {run.data.spec.wallHeightFt} ft walls, {run.data.spec.roofPitch}/12 roof
            {run.data.source === 'ai' ? ' (read by AI).' : '.'}
          </p>
          {run.data.notes.length > 0 && (
            <ul>
              {run.data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
