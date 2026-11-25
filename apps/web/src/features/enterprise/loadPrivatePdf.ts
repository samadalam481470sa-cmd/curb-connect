const assets = '/pdfjs/';

export async function loadPrivatePdfEngine() {
  const engine = await import('pdfjs-dist/legacy/build/pdf.mjs');
  engine.GlobalWorkerOptions.workerSrc = assets + 'pdf.worker.min.mjs';
  return (url: string) =>
    engine.getDocument({
      url,
      withCredentials: true,
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true,
      cMapUrl: assets + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: assets + 'standard_fonts/',
      wasmUrl: assets + 'wasm/',
      stopAtErrors: true,
    });
}
