// AutoCAD DWG -> ASCII DXF with GNU LibreDWG (WebAssembly build @mlightcad/libredwg-web 0.9.3,
// GPL-3.0, server-side only; never sent to browsers). The package has no dependencies and no
// install scripts; it was checked before it was added. The DXF then goes through the same plan
// reader as an uploaded DXF.
type LibreDwgLike = { dwg_write_dxf(content: ArrayBuffer): Uint8Array | null };
let lib: Promise<LibreDwgLike> | null = null;

/** DWG files start with "AC10" and a version number (AC1015 = AutoCAD 2000 ... AC1032 = 2018+). */
export function looksLikeDwg(bytes: Uint8Array): boolean {
  return bytes.length > 6 && bytes[0] === 0x41 && bytes[1] === 0x43 && bytes[2] === 0x31 && bytes[3] === 0x30;
}

export async function dwgBytesToDxf(bytes: ArrayBuffer): Promise<string | null> {
  if (!looksLikeDwg(new Uint8Array(bytes))) return null;
  lib ??= import('@mlightcad/libredwg-web').then((m) => m.LibreDwg.create() as Promise<LibreDwgLike>);
  const dxf = (await lib).dwg_write_dxf(bytes);
  return dxf && dxf.length ? new TextDecoder('latin1').decode(dxf) : null;
}
