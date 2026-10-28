/* Carga masiva: muchos archivos (de varias campañas y meses) en un solo paso. Cada campaña × mes queda como una
   carga normal, con versión y respaldo.
   - Tipificaciones y ventas del CRM: cada fila va al mes de su fecha (un archivo puede repartirse en varios meses).
   - Sábanas: cada archivo es la sábana de UN mes y se guarda completa (trae a propósito la cosecha de meses
     anteriores); el mes sale del nombre del archivo o, si no lo dice, del mes más reciente de sus ventas. */
import { CAMPAIGNS, type CampaignCode } from "./campaigns";

export interface ScannedFile {
  /** Posición del archivo en la lista del ZIP. */
  index: number;
  campaign: CampaignCode;
  /** Llamadas por mes (AAAA-MM) según su fecha. */
  byMonth: Record<string, number>;
}

export interface BulkUnit {
  campaign: CampaignCode;
  month: string;
  rows: number;
  /** Archivos que traen llamadas de ese mes (casi siempre uno). */
  files: number[];
  /** Ese mes ya tenía tipificaciones vigentes. */
  exists: boolean;
  /** Se guarda (los que ya existían solo si se pidió reemplazarlos). */
  upload: boolean;
  /** Sábanas: dos archivos dicen ser del mismo mes; no se guarda ninguno hasta corregir el mes. */
  conflicto?: boolean;
  /** Bases: qué base es (p. ej. "tdc:base:primeras") y cómo entra si el mes ya tiene una. */
  dataset?: string;
  modo?: "nueva" | "reemplazar" | "adicional";
}

export type BulkKind = "tipif" | "ventas" | "sabana" | "base";

/** Clave de una carga del plan (las bases van por archivo: un mes puede tener original y adicionales). */
export const claveUnidad = (u: Pick<BulkUnit, "campaign" | "month" | "dataset" | "files">) => (u.dataset ? `${u.dataset}|${u.month}|${u.files[0]}` : unitKey(u.campaign, u.month));

export const unitKey = (campaign: string, month: string) => `${campaign}|${month}`;

export function planBulk(files: readonly ScannedFile[], existing: ReadonlySet<string>, replace: boolean): BulkUnit[] {
  const units = new Map<string, BulkUnit>();
  for (const f of files) {
    for (const [month, n] of Object.entries(f.byMonth)) {
      if (!n) continue;
      const k = unitKey(f.campaign, month);
      const u = units.get(k) ?? { campaign: f.campaign, month, rows: 0, files: [], exists: existing.has(k), upload: false };
      u.rows += n;
      if (!u.files.includes(f.index)) u.files.push(f.index);
      units.set(k, u);
    }
  }
  const order = new Map(CAMPAIGNS.map((c, i) => [c.code, i]));
  return [...units.values()]
    .map((u) => ({ ...u, upload: !u.exists || replace }))
    .sort((a, b) => order.get(a.campaign)! - order.get(b.campaign)! || a.month.localeCompare(b.month));
}

/**
 * Mes de una sábana según sus ventas: el más reciente que trae una parte real de las filas (al menos el 2 %).
 * Una sábana de octubre trae ventas de octubre y la cosecha de meses anteriores; una fecha mal escrita
 * de noviembre no la vuelve de noviembre.
 */
export function mesDeSabana(byMonth: Readonly<Record<string, number>>): string | null {
  const total = Object.values(byMonth).reduce((a, b) => a + b, 0);
  const meses = Object.entries(byMonth)
    .filter(([, n]) => n > 0 && n >= total * 0.02)
    .map(([m]) => m)
    .sort();
  return meses.at(-1) ?? null;
}

export interface SabanaFile {
  index: number;
  campaign: CampaignCode;
  month: string;
  rows: number;
}

/** Sábanas: una carga por archivo. Dos archivos del mismo campaña × mes quedan en conflicto (no se guarda ninguno). */
export function planSabanas(files: readonly SabanaFile[], existing: ReadonlySet<string>, replace: boolean): BulkUnit[] {
  const units = new Map<string, BulkUnit>();
  for (const f of files) {
    const k = unitKey(f.campaign, f.month);
    const u = units.get(k) ?? { campaign: f.campaign, month: f.month, rows: 0, files: [], exists: existing.has(k), upload: false };
    u.rows += f.rows;
    u.files.push(f.index);
    units.set(k, u);
  }
  const order = new Map(CAMPAIGNS.map((c, i) => [c.code, i]));
  return [...units.values()]
    .map((u) => ({ ...u, conflicto: u.files.length > 1, upload: u.files.length === 1 && (!u.exists || replace) }))
    .sort((a, b) => order.get(a.campaign)! - order.get(b.campaign)! || a.month.localeCompare(b.month));
}

export interface BaseFile {
  index: number;
  campaign: CampaignCode;
  dataset: string;
  month: string;
  rows: number;
}
/** Qué hacer con una base de un mes que ya tiene una cargada. */
export type SiExiste = "saltar" | "reemplazar" | "adicional";

/**
 * Bases: una carga por archivo. El primer archivo de cada base × mes es la base del mes (si ya había una: se salta,
 * la reemplaza o se suma como adicional, según `siExiste`); los demás archivos de esa misma base y mes se suman como
 * bases adicionales (el banco mandó más clientes).
 */
export function planBases(files: readonly BaseFile[], existing: ReadonlySet<string>, siExiste: SiExiste): BulkUnit[] {
  const vistos = new Set<string>();
  const order = new Map(CAMPAIGNS.map((c, i) => [c.code, i]));
  return files
    .map((f): BulkUnit => {
      const k = `${f.dataset}|${f.month}`;
      const exists = existing.has(k);
      const primero = !vistos.has(k);
      vistos.add(k);
      const modo: BulkUnit["modo"] = !primero ? "adicional" : !exists ? "nueva" : siExiste === "saltar" ? undefined : siExiste;
      return { campaign: f.campaign, month: f.month, rows: f.rows, files: [f.index], exists, upload: Boolean(modo), dataset: f.dataset, modo };
    })
    .sort((a, b) => order.get(a.campaign)! - order.get(b.campaign)! || a.month.localeCompare(b.month) || a.dataset!.localeCompare(b.dataset!) || a.files[0]! - b.files[0]!);
}
