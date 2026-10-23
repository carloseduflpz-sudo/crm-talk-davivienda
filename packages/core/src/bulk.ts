/* Carga histórica: muchos archivos de tipificaciones (de varias campañas y meses) se reparten por
   campaña y mes según la fecha de cada llamada. Cada campaña × mes queda como una carga normal. */
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
}

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
