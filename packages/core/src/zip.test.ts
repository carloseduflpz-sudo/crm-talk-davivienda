import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { guessCampaign, isSheetFile, listZip, readZipEntry } from "./zip";

/** ZIP mínimo para las pruebas (sin CRC real: el lector no lo revisa). */
function makeZip(files: { path: string; data: Uint8Array; store?: boolean; utf8?: boolean }[]): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = f.utf8 === false ? Uint8Array.from([...f.path].map((c) => c.charCodeAt(0))) : enc.encode(f.path);
    const body = f.store ? f.data : new Uint8Array(deflateRawSync(f.data));
    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(6, f.utf8 === false ? 0 : 0x800, true);
    dv.setUint16(8, f.store ? 0 : 8, true);
    dv.setUint32(18, body.length, true);
    dv.setUint32(22, f.data.length, true);
    dv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(8, f.utf8 === false ? 0 : 0x800, true);
    cv.setUint16(10, f.store ? 0 : 8, true);
    cv.setUint32(20, body.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    chunks.push(local, body);
    central.push(cd);
    offset += local.length + body.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...chunks, ...central, end] as BlobPart[]);
}

describe("ZIP con varios archivos", () => {
  it("lista los archivos (sin carpetas ni basura) y lee cada uno", async () => {
    const text = (s: string) => new TextEncoder().encode(s.repeat(50));
    const zip = makeZip([
      { path: "TDC/", data: new Uint8Array() , store: true },
      { path: "TDC/Tipificaciones Enero.xlsx", data: text("enero ") },
      { path: "CDC/Febrero.xlsx", data: text("febrero "), store: true },
      { path: "__MACOSX/TDC/._Enero.xlsx", data: text("x") },
      { path: "TDC/~$Enero.xlsx", data: text("x") },
    ]);
    const list = await listZip(zip);
    expect(list.map((e) => e.path)).toEqual(["TDC/Tipificaciones Enero.xlsx", "CDC/Febrero.xlsx"]);
    expect(new TextDecoder().decode(await readZipEntry(zip, list[0]!))).toBe("enero ".repeat(50));
    expect(new TextDecoder().decode(await readZipEntry(zip, list[1]!))).toBe("febrero ".repeat(50));
  });

  it("nombres guardados por Windows sin UTF-8", async () => {
    const zip = makeZip([{ path: "Tipificación Seguros.xlsx", data: new Uint8Array([1, 2, 3]), utf8: false }]);
    expect((await listZip(zip))[0]!.name).toBe("Tipificación Seguros.xlsx");
  });

  it("no es un ZIP: mensaje claro", async () => {
    let msg = "";
    try {
      await listZip(new Blob([new Uint8Array(100)]));
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/No es un archivo ZIP/);
  });

  it("la campaña sale del nombre del archivo o de la carpeta", () => {
    expect(guessCampaign("Tipificaciones/TDC/Enero 2026.xlsx")).toBe("tdc");
    expect(guessCampaign("2026/Extrafinanciamiento Marzo.xlsx")).toBe("extrafin");
    expect(guessCampaign("Compra de Cartera/abril.xlsx")).toBe("cdc");
    expect(guessCampaign("UPIN mayo.xlsx")).toBe("upin");
    expect(guessCampaign("SEGUROS/JUNIO.xlsx")).toBe("seguros");
    expect(guessCampaign("Domiciliaciones julio.xlsx")).toBe("domi");
    expect(guessCampaign("TC Primeras Cuentas.xlsx")).toBe("tdc");
    expect(guessCampaign("Extra TDC.xlsx")).toBe("extrafin");
    expect(guessCampaign("Enero.xlsx")).toBeNull();
    expect(isSheetFile("a.xlsb") && !isSheetFile("a.pdf")).toBe(true);
  });
});
