/* SheetJS (lector de Excel) se sirve desde la propia app y se carga solo cuando hace falta. */
import type { WorkBookLike, XLSXLike } from "@crm/core";

export type XLSXLib = XLSXLike & { read(data: ArrayBuffer | Uint8Array, opts: Record<string, unknown>): WorkBookLike };

let loading: Promise<XLSXLib> | null = null;

export function loadXLSX(): Promise<XLSXLib> {
  const w = window as unknown as { XLSX?: XLSXLib };
  if (w.XLSX) return Promise.resolve(w.XLSX);
  loading ??= new Promise<XLSXLib>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "/vendor/xlsx-0.18.5.full.min.js";
    s.async = true;
    s.onload = () => (w.XLSX ? resolve(w.XLSX) : reject(new Error("No se pudo iniciar el lector de Excel.")));
    s.onerror = () => {
      loading = null;
      reject(new Error("No se pudo descargar el lector de Excel. Revisa tu conexión."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "2026-09" → "septiembre 2026" */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] ?? ym} ${y ?? ""}`.trim();
}
