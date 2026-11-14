// Test-only page: mounts the curb camera and AR measure components without sign-in or the API.
// Served by Vite for e2e/camera.spec.ts; never part of the Next.js build.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/app/command-center.css';
import { CurbARMeasure } from '../../src/features/curb/CurbARMeasure';
import { CurbCameraMeasure } from '../../src/features/curb/CurbCameraMeasure';

function Harness() {
  const [applied, setApplied] = useState<number | null>(null);
  return (
    <main>
      <h1 style={{ fontSize: 20 }}>Curb measure harness</h1>
      <section className="cc-panel" id="curb-spatial-ar">
        <CurbARMeasure onApplyLength={setApplied} />
      </section>
      <section className="cc-panel" id="curb-camera-measure">
        <CurbCameraMeasure onApplyLength={setApplied} />
      </section>
      <p data-testid="applied">{applied === null ? 'none' : String(applied)}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);

// Test hook: lets e2e checks call the snapping code directly on a decoded photo.
import { snapToCorner, snapToEdge, toGray } from '../../src/features/curb/edgeSnap';
(window as unknown as Record<string, unknown>).__curbSnap = { snapToCorner, snapToEdge, toGray };
