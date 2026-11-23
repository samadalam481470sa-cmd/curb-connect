'use client';

// Photo inspection report: mark findings directly on roof photos and print a
// branded pass/fail report before leaving the driveway. Additive to the
// existing roof flow — photos are prepared with the same browser downscale as
// RoofDamageCheck, prices come only from the contractor (blank = missing),
// and nothing is uploaded: the report is generated locally for print/PDF.
import { useRef, useState, type MouseEvent } from 'react';
import { PageHeader } from '../../../components/common';
import { RouteGate } from '../../../components/RouteGate';
import { photoToJpegBase64 } from '../RoofDamageCheck';
import {
  EMPTY_INSPECTION,
  FINDING_RESULTS,
  FINDING_TYPES,
  SEVERITIES,
  addMarker,
  createMarker,
  findingLabel,
  formatCents,
  inspectionReportHtml,
  newInspectionId,
  parseMoneyText,
  removeMarker,
  summarizeInspection,
  updateMarker,
  type FindingResult,
  type FindingTypeId,
  type Inspection,
  type Severity,
} from './inspection';

export function PhotoInspection() {
  return (
    <RouteGate routeId="roof.inspection">
      <PhotoInspectionContent />
    </RouteGate>
  );
}

function PhotoInspectionContent() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inspection, setInspection] = useState<Inspection>(EMPTY_INSPECTION);
  const [photoDataUrls, setPhotoDataUrls] = useState<Record<string, string>>({});
  const [activePhotoId, setActivePhotoId] = useState<string | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [pendingType, setPendingType] = useState<FindingTypeId>('missing_shingles');
  const [pendingSeverity, setPendingSeverity] = useState<Severity>('moderate');
  const [pendingResult, setPendingResult] = useState<FindingResult>('fail');

  const summary = summarizeInspection(inspection);
  const activePhoto = inspection.photos.find((p) => p.id === activePhotoId) ?? inspection.photos[0];

  function patchInspection(patch: Partial<Inspection>) {
    setInspection((s) => ({ ...s, ...patch }));
  }

  function patchPhoto(photoId: string, next: Inspection['photos'][number]) {
    setInspection((s) => ({ ...s, photos: s.photos.map((p) => (p.id === photoId ? next : p)) }));
  }

  async function onPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    setPrepError(null);
    setPreparing(true);
    try {
      for (const file of Array.from(files)) {
        const base64 = await photoToJpegBase64(file);
        const id = newInspectionId('photo');
        setPhotoDataUrls((prev) => ({ ...prev, [id]: `data:image/jpeg;base64,${base64}` }));
        setInspection((s) => ({
          ...s,
          photos: [...s.photos, { id, name: file.name || `Photo ${s.photos.length + 1}`, markers: [] }],
        }));
        setActivePhotoId(id);
      }
    } catch (err) {
      setPrepError(err instanceof Error ? err.message : 'Could not read that photo.');
    } finally {
      setPreparing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onPhotoClick(event: MouseEvent<HTMLDivElement>) {
    if (!activePhoto) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const marker = createMarker({
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
      findingType: pendingType,
      severity: pendingSeverity,
      result: pendingResult,
    });
    patchPhoto(activePhoto.id, addMarker(activePhoto, marker));
  }

  function openReport() {
    const html = inspectionReportHtml({ inspection, photoDataUrls });
    const w = window.open('', '_blank', 'noopener=no');
    if (!w) {
      window.alert('Allow pop-ups for Field Pro to open the inspection report.');
      return;
    }
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 400);
  }

  return (
    <div style={{ padding: 16, display: 'grid', gap: 16 }}>
      <PageHeader
        title="Photo inspection report"
        description="Tap a photo to mark each finding, set its result and your price, then print the report before you leave. Blank prices stay missing — Field Pro never invents a price."
      />

      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}>
        <label>
          Job address
          <input
            value={inspection.address}
            onChange={(e) => patchInspection({ address: e.target.value })}
            placeholder="123 Main St, Carrollton, TX"
          />
        </label>
        <label>
          Customer name
          <input value={inspection.customer} onChange={(e) => patchInspection({ customer: e.target.value })} />
        </label>
        <label>
          Inspector
          <input value={inspection.inspector} onChange={(e) => patchInspection({ inspector: e.target.value })} />
        </label>
        <label>
          Inspection date
          <input type="date" value={inspection.date} onChange={(e) => patchInspection({ date: e.target.value })} />
        </label>
        <label>
          Company name
          <input value={inspection.companyName} onChange={(e) => patchInspection({ companyName: e.target.value })} />
        </label>
        <label>
          Phone
          <input value={inspection.phone} onChange={(e) => patchInspection({ phone: e.target.value })} />
        </label>
        <label>
          License
          <input value={inspection.license} onChange={(e) => patchInspection({ license: e.target.value })} />
        </label>
      </div>

      <div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          aria-label="Add inspection photos"
          onChange={(e) => void onPhotos(e.target.files)}
        />
        {preparing ? <p>Preparing photo…</p> : null}
        {prepError ? <p role="alert">{prepError}</p> : null}
      </div>

      {inspection.photos.length > 0 ? (
        <div role="tablist" aria-label="Inspection photos" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {inspection.photos.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={activePhoto?.id === p.id}
              onClick={() => setActivePhotoId(p.id)}
            >
              {p.name} ({p.markers.length})
            </button>
          ))}
        </div>
      ) : (
        <p>Add a roof photo to start marking findings.</p>
      )}

      {activePhoto ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label>
              Finding
              <select value={pendingType} onChange={(e) => setPendingType(e.target.value as FindingTypeId)}>
                {FINDING_TYPES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Severity
              <select value={pendingSeverity} onChange={(e) => setPendingSeverity(e.target.value as Severity)}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Result
              <select value={pendingResult} onChange={(e) => setPendingResult(e.target.value as FindingResult)}>
                {FINDING_RESULTS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <p style={{ margin: 0 }}>Tap the photo to place a marker with these settings.</p>
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label={`Mark findings on ${activePhoto.name}. Activate, then use the finding list below to edit each marker.`}
            onClick={onPhotoClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const marker = createMarker({
                  x: 0.5,
                  y: 0.5,
                  findingType: pendingType,
                  severity: pendingSeverity,
                  result: pendingResult,
                });
                patchPhoto(activePhoto.id, addMarker(activePhoto, marker));
              }
            }}
            style={{ position: 'relative', display: 'inline-block', maxWidth: '100%', cursor: 'crosshair' }}
          >
            <img
              src={photoDataUrls[activePhoto.id]}
              alt={activePhoto.name}
              style={{ maxWidth: '100%', display: 'block' }}
            />
            {activePhoto.markers.map((m, i) => (
              <span
                key={m.id}
                title={`${findingLabel(m.findingType)} — ${m.result}`}
                style={{
                  position: 'absolute',
                  left: `${m.x * 100}%`,
                  top: `${m.y * 100}%`,
                  transform: 'translate(-50%,-50%)',
                  background: m.result === 'pass' ? '#1a7f37' : m.result === 'monitor' ? '#b54708' : '#b00020',
                  color: '#fff',
                  borderRadius: '50%',
                  width: 24,
                  height: 24,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  border: '2px solid #fff',
                }}
              >
                {i + 1}
              </span>
            ))}
          </div>

          <ol style={{ display: 'grid', gap: 12, paddingLeft: 20 }}>
            {activePhoto.markers.map((m, i) => {
              const cents = parseMoneyText(m.priceText);
              const priceInvalid = cents !== null && Number.isNaN(cents);
              return (
                <li key={m.id}>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
                    <strong>#{i + 1}</strong>
                    <label>
                      Finding
                      <select
                        value={m.findingType}
                        onChange={(e) =>
                          patchPhoto(
                            activePhoto.id,
                            updateMarker(activePhoto, m.id, { findingType: e.target.value as FindingTypeId }),
                          )
                        }
                      >
                        {FINDING_TYPES.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Severity
                      <select
                        value={m.severity}
                        onChange={(e) =>
                          patchPhoto(activePhoto.id, updateMarker(activePhoto, m.id, { severity: e.target.value as Severity }))
                        }
                      >
                        {SEVERITIES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Result
                      <select
                        value={m.result}
                        onChange={(e) =>
                          patchPhoto(activePhoto.id, updateMarker(activePhoto, m.id, { result: e.target.value as FindingResult }))
                        }
                      >
                        {FINDING_RESULTS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Note
                      <input
                        value={m.note}
                        onChange={(e) => patchPhoto(activePhoto.id, updateMarker(activePhoto, m.id, { note: e.target.value }))}
                      />
                    </label>
                    <label>
                      Your price ($)
                      <input
                        value={m.priceText}
                        inputMode="decimal"
                        placeholder="Blank = missing"
                        aria-invalid={priceInvalid}
                        onChange={(e) =>
                          patchPhoto(activePhoto.id, updateMarker(activePhoto, m.id, { priceText: e.target.value }))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => patchPhoto(activePhoto.id, removeMarker(activePhoto, m.id))}
                    >
                      Remove marker {i + 1}
                    </button>
                  </div>
                  {priceInvalid ? <p role="alert">Enter a price like 450 or leave it blank.</p> : null}
                </li>
              );
            })}
          </ol>
        </>
      ) : null}

      <section aria-labelledby="inspection-summary-title">
        <h2 id="inspection-summary-title">Summary</h2>
        <p>
          Overall: <strong>{summary.overall.toUpperCase()}</strong> — {summary.failCount} fail ·{' '}
          {summary.monitorCount} monitor · {summary.passCount} pass ({summary.totalMarkers} findings)
        </p>
        {summary.byType.length > 0 ? (
          <ul>
            {summary.byType.map((r) => (
              <li key={r.id}>
                {r.label}: {r.count}
              </li>
            ))}
          </ul>
        ) : null}
        <p>
          Priced total: <strong>{formatCents(summary.pricedTotalCents)}</strong>
          {summary.missingPriceCount > 0
            ? ` · ${summary.missingPriceCount} finding(s) still need a price — not final.`
            : summary.totalMarkers > 0
              ? ' · All findings priced.'
              : ''}
        </p>
        <button type="button" onClick={openReport} disabled={inspection.photos.length === 0}>
          Open inspection report (print / Save as PDF)
        </button>
      </section>
    </div>
  );
}
