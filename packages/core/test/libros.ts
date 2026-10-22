/* Libros de Excel de prueba con datos INVENTADOS, generados desde los perfiles. */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PROFILES, WorkbookReader, type XLSXLike } from "../src/importers";

const require = createRequire(import.meta.url);
export const XLSX = require(fileURLToPath(new URL("../../../apps/web/public/vendor/xlsx-0.18.5.full.min.js", import.meta.url))) as XLSXLike & {
  utils: { book_new(): unknown; aoa_to_sheet(a: unknown[][]): unknown; book_append_sheet(wb: unknown, ws: unknown, name: string): void };
  write(wb: unknown, o: Record<string, unknown>): Uint8Array;
  read(d: Uint8Array, o: Record<string, unknown>): { SheetNames: string[]; Sheets: Record<string, unknown> };
};

/* Valor inventado según el tipo de columna. */
function sample(header: string, type: string | undefined, i: number): unknown {
  const h = header.toLowerCase();
  if (type === "niu") return `00${12340 + i}`;
  if (type === "dmy" || type === "isoDMY" || type === "rawdate") return `${String(10 + i).padStart(2, "0")}/09/2026`;
  if (type === "iso" || type === "isoKeep") return `2026-09-${String(10 + i).padStart(2, "0")}`;
  if (type === "isoDateTime") return `2026-09-${String(10 + i).padStart(2, "0")} 10:1${i}:00`;
  if (type === "num" || type === "int") return 1000 + i;
  if (h.includes("subetapa")) return ["ENTREGADA", "RECHAZADA", "EN ANALISIS"][i % 3];
  if (h.includes("status") || h.includes("etapa") || h === "estado") return ["APLICADO", "RECHAZADO", "EN PROCESO"][i % 3];
  if (h === "categoria") return "Contacto efectivo positivo";
  if (h === "tipologia") return "Venta realizada";
  if (h === "full_name" || h === "agente" || h.includes("ejecutivo") || h === "operador" || h === "usuarios") return `Agente ${i % 2}`;
  if (h.includes("perfil")) return `P${i % 3}`;
  return `${header} ${i}`;
}

/** Libro de Excel con la hoja y encabezados que espera el perfil, más una fila sin NIU. */
export function workbookFor(datasetId: string) {
  const prof = PROFILES[datasetId]!;
  const wb = XLSX.utils.book_new();
  const parts = prof.multiSheet
    ? prof.multiSheet.map((p) => ({ sheet: p.sheet, fields: { ...prof.fields, ...p.extra } }))
    : [{ sheet: prof.sheets?.[0] ?? "Hoja1", fields: prof.fields }];
  for (const part of parts) {
    const specs = Object.values(part.fields).filter((s) => s[0] !== "__no__");
    const headers = specs.map((s) => (Array.isArray(s[0]) ? s[0][0]! : s[0]));
    const rows: unknown[][] = [["Reporte generado para pruebas"], headers];
    for (let i = 0; i < 3; i++) rows.push(specs.map((s, j) => sample(headers[j]!, s[1], i)));
    rows.push(specs.map((s, j) => (s[1] === "niu" ? "" : sample(headers[j]!, s[1], 9)))); // sin NIU
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), part.sheet);
  }
  // Ida y vuelta por un .xlsx real, como cuando el usuario sube el archivo.
  const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return new WorkbookReader(XLSX, XLSX.read(new Uint8Array(bytes), { type: "array", cellDates: false }));
}

