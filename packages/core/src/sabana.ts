/* Sábanas incompletas: a veces el banco manda una sábana que trae menos que la anterior del mismo mes
   (menos ventas, llega a un día anterior, le falta un proceso o la cosecha de un mes). Antes de reemplazar
   la vigente se comparan las dos y, si la nueva trae menos, se avisa. */
import type { NormalizedRow, SaleRow } from "./importers";

/** Lo que trae una sábana: filas, hasta qué día del mes llega y cuántas filas por mes de venta y por proceso. */
export interface SabanaSummary {
  filas: number;
  hasta: string | null;
  porMes: Record<string, number>;
  porProceso: Record<string, number>;
  cargada?: number;
}

export function summarizeSales(rows: readonly NormalizedRow[], month: string): SabanaSummary {
  const out: SabanaSummary = { filas: rows.length, hasta: null, porMes: {}, porProceso: {} };
  for (const r of rows as readonly SaleRow[]) {
    const d = r.saleDate ?? "";
    const m = d.slice(0, 7);
    out.porMes[m] = (out.porMes[m] ?? 0) + 1;
    const p = r.process ?? "";
    out.porProceso[p] = (out.porProceso[p] ?? 0) + 1;
    if (d.startsWith(month) && (!out.hasta || d > out.hasta)) out.hasta = d.slice(0, 10);
  }
  return out;
}

export interface SabanaDiff {
  /** true si la nueva trae menos que la vigente en algo. */
  menos: boolean;
  puntos: { que: string; antes: string | number; ahora: string | number; menos: boolean }[];
}

/** Compara la sábana vigente (`antes`) con la nueva (`ahora`) del mismo mes. */
export function compareSabanas(antes: SabanaSummary, ahora: SabanaSummary, month: string): SabanaDiff {
  const puntos: SabanaDiff["puntos"] = [];
  puntos.push({ que: "Ventas en la sábana", antes: antes.filas, ahora: ahora.filas, menos: ahora.filas < antes.filas });
  const hastaMenos = Boolean(antes.hasta && (!ahora.hasta || ahora.hasta < antes.hasta));
  puntos.push({ que: "Llega hasta", antes: antes.hasta ?? "—", ahora: ahora.hasta ?? "—", menos: hastaMenos });
  // Ventas del mes y cosecha de cada mes anterior.
  const meses = [...new Set([...Object.keys(antes.porMes), ...Object.keys(ahora.porMes)])].filter(Boolean).sort().reverse();
  for (const m of meses) {
    const a = antes.porMes[m] ?? 0;
    const b = ahora.porMes[m] ?? 0;
    if (a === b) continue;
    puntos.push({ que: m === month ? "Vendidas en el mes" : `Cosecha de ${m}`, antes: a, ahora: b, menos: b < a });
  }
  const procesos = [...new Set([...Object.keys(antes.porProceso), ...Object.keys(ahora.porProceso)])].filter(Boolean);
  if (procesos.length > 1 || procesos.some((p) => !antes.porProceso[p] || !ahora.porProceso[p])) {
    for (const p of procesos.sort()) {
      const a = antes.porProceso[p] ?? 0;
      const b = ahora.porProceso[p] ?? 0;
      if (a === b) continue;
      puntos.push({ que: `Proceso ${p}`, antes: a, ahora: b, menos: b < a });
    }
  }
  return { menos: puntos.some((x) => x.menos), puntos };
}
