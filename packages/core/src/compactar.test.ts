/* La compactación debe dar EXACTAMENTE los mismos datos que el libro original, solo que sin la cola
   de filas vacías con formato. Libros inventados, generados aquí mismo. */
import { describe, expect, it } from "vitest";
import { XLSX } from "../test/libros";
import { compactWorkbook } from "./compactar";

type W = typeof XLSX & { utils: { sheet_to_json(ws: unknown, o: Record<string, unknown>): unknown[][] } };
const X = XLSX as W;

/** Libro con `data` filas con valores y una cola de filas vacías con formato hasta `tail`. */
function bookWithTail(bookType: "xlsx" | "xlsb", data: number, tail: number): Uint8Array {
  const rows: unknown[][] = [["Reporte de prueba"], ["NIU", "Perfil", "Monto"]];
  for (let i = 0; i < data; i++) rows.push([String(1000 + i), `P${i % 3}`, i * 10.5]);
  const ws = X.utils.aoa_to_sheet(rows) as Record<string, unknown>;
  // Celdas vacías con formato (como las que deja el banco hasta el final de la hoja).
  for (let r = rows.length; r < tail; r++) for (const c of ["A", "B", "C"]) ws[`${c}${r + 1}`] = { t: "z", s: { numFmt: "0" } };
  ws["!ref"] = `A1:C${tail}`;
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([["Resumen"], ["Total", data]]), "Resumen");
  X.utils.book_append_sheet(wb, ws, "Entregable");
  return new Uint8Array(X.write(wb, { type: "array", bookType, sheetStubs: true, compression: true }));
}

const rowsOf = (bytes: Uint8Array, sheet: string) =>
  X.utils.sheet_to_json((X.read(bytes, { type: "array", cellDates: false, dense: true }) as { Sheets: Record<string, unknown> }).Sheets[sheet], { header: 1, raw: true, defval: null, blankrows: false });

describe("compactar libros con filas vacías al final", () => {
  for (const bookType of ["xlsb", "xlsx"] as const) {
    it(`${bookType}: recorta la cola y conserva todos los datos`, async () => {
      const original = bookWithTail(bookType, 120, 6_000);
      const c = await compactWorkbook(original, { gap: 500, minSheetBytes: 0 });
      expect(c).not.toBe(null);
      expect(c!.sheets.length).toBe(1);
      expect(c!.sheets[0]!.after < c!.sheets[0]!.before).toBe(true);
      expect(rowsOf(c!.data, "Entregable")).toEqual(rowsOf(original, "Entregable"));
      expect(rowsOf(c!.data, "Resumen")).toEqual(rowsOf(original, "Resumen"));
      expect(rowsOf(c!.data, "Entregable")).toHaveLength(122);
    });

    it(`${bookType}: sin cola larga no toca nada`, async () => {
      const original = bookWithTail(bookType, 120, 400);
      expect(await compactWorkbook(original, { gap: 500, minSheetBytes: 0 })).toBe(null);
    });
  }

  it("un hueco de filas vacías más corto que el umbral no corta los datos de después", async () => {
    const rows: unknown[][] = [["NIU"], ["1"]];
    const ws = X.utils.aoa_to_sheet(rows) as Record<string, unknown>;
    for (let r = 2; r < 300; r++) ws[`A${r + 1}`] = { t: "z", s: { numFmt: "0" } };
    ws["A301"] = { t: "s", v: "999" };
    for (let r = 301; r < 3000; r++) ws[`A${r + 1}`] = { t: "z", s: { numFmt: "0" } };
    ws["!ref"] = "A1:A3000";
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws, "Hoja1");
    const bytes = new Uint8Array(X.write(wb, { type: "array", bookType: "xlsb", sheetStubs: true, compression: true }));
    const c = await compactWorkbook(bytes, { gap: 500, minSheetBytes: 0 });
    expect(rowsOf(c!.data, "Hoja1")).toEqual([["NIU"], ["1"], ["999"]]);
  });

  it("archivos que no son zip (csv, xls antiguo) se dejan tal cual", async () => {
    expect(await compactWorkbook(new TextEncoder().encode("NIU,Perfil\n1,P1\n"))).toBe(null);
  });
});
