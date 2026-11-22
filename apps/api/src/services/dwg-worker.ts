// Worker thread for AutoCAD DWG -> DXF conversion (GNU LibreDWG compiled to WebAssembly,
// @mlightcad/libredwg-web, GPL-3.0, used on the server only). The conversion is synchronous and
// CPU-bound, so it runs here, off the request thread, and the caller can stop it on a timeout.
import { parentPort } from 'node:worker_threads';
import { dwgBytesToDxf } from './plan-dwg-core';

parentPort?.on('message', async (bytes: ArrayBuffer) => {
  try {
    parentPort?.postMessage({ ok: true, dxf: await dwgBytesToDxf(bytes) });
  } catch (err) {
    parentPort?.postMessage({ ok: false, error: (err as Error).message });
  }
});
