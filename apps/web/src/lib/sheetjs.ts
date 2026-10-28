/* SheetJS (el mismo lector de Excel que usa el Centro de carga), cargado solo cuando se necesita. */
import type { Hoja } from "@crm/core";
export type XLSXLib = {
  read(data: ArrayBuffer, opts: Record<string, unknown>): { SheetNames: string[]; Sheets: Record<string, unknown> };
  utils: { sheet_to_json(ws: unknown, opts: Record<string, unknown>): Hoja };
};
let sheetjs: Promise<XLSXLib> | null = null;
export function cargarSheetJS(): Promise<XLSXLib> {
  const w = window as unknown as { XLSX?: XLSXLib };
  sheetjs ??= new Promise((resolve, reject) => {
    if (w.XLSX) return resolve(w.XLSX);
    const s = document.createElement("script");
    s.src = "/vendor/xlsx-0.18.5.full.min.js";
    s.onload = () => (w.XLSX ? resolve(w.XLSX) : reject(new Error("No se pudo abrir el lector de Excel.")));
    s.onerror = () => {
      sheetjs = null;
      reject(new Error("No se pudo abrir el lector de Excel. Revisa tu conexión y vuelve a intentar."));
    };
    document.head.append(s);
  });
  return sheetjs;
}

