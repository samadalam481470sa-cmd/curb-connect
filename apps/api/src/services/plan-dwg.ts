// Converts an uploaded AutoCAD DWG to DXF text in a worker thread with a time limit.
// In tests (TypeScript source, no built worker file) it converts in-process instead.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { dwgBytesToDxf } from './plan-dwg-core';

export { looksLikeDwg } from './plan-dwg-core';

export async function dwgToDxf(data: Uint8Array, timeoutMs = 20_000): Promise<string | null> {
  const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const workerUrl = new URL('./dwg-worker.js', import.meta.url);
  if (!existsSync(fileURLToPath(workerUrl))) return dwgBytesToDxf(bytes);
  const worker = new Worker(workerUrl, { resourceLimits: { maxOldGenerationSizeMb: 512 } });
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('DWG conversion timed out')), timeoutMs);
      worker.once('message', (m: { ok: boolean; dxf?: string | null; error?: string }) => {
        clearTimeout(timer);
        if (m.ok) resolve(m.dxf ?? null);
        else reject(new Error(m.error ?? 'DWG conversion failed'));
      });
      worker.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      worker.postMessage(bytes, [bytes]);
    });
  } finally {
    await worker.terminate();
  }
}
