/* Metas y cumplimientos oficiales: el Excel "Cumplimientos de campaña Davivienda" (una hoja por año; por campaña
   un bloque con su nombre y las filas Mes · Meta · Real · Cumplimiento). Es la fuente del gap trimestral de la
   presentación y de los meses cerrados del Histórico. */
import type { CampaignCode } from "./campaigns";
import { campanaDeTitulo } from "./presentacion";

/** Celda de una hoja leída con SheetJS (header: 1). */
type Celda = unknown;

export interface MesOficial {
  campaign: CampaignCode;
  month: string;
  meta: number | null;
  real: number | null;
}

/** Lo guardado: por campaña y mes, con de qué archivo salió. */
export interface Oficial {
  archivo: string;
  por: string;
  fecha: number;
  meses: MesOficial[];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const texto = (c: Celda) => (typeof c === "string" ? c : "");
const numero = (c: Celda): number | null => {
  if (typeof c === "number" && Number.isFinite(c)) return Math.round(c * 100) / 100;
  if (typeof c === "string" && /^\s*-?[\d,]+(\.\d+)?\s*$/.test(c)) return Math.round(Number(c.replace(/,/g, "")) * 100) / 100;
  return null;
};

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "Enero", "Septimebre", "Noviemre", "Set." → 1…12 (por las primeras letras, aguanta errores de dedo). */
function numeroDeMes(c: Celda): number | null {
  const t = norm(texto(c)).replace(/[^a-z]/g, "");
  if (t.length < 3) return null;
  const k = t.startsWith("set") ? "sep" : t.slice(0, 3);
  const i = MESES.indexOf(k);
  return i >= 0 ? i + 1 : null;
}

/**
 * Lee el Excel de cumplimientos. Hojas: el año en el nombre ("2025", "2026", "Cumplimiento 2026").
 * En cada hoja, cada bloque: una fila con el nombre de la campaña, la fila "Mes" con los meses y las filas
 * "Meta" y "Real". Lo demás (Cumplimiento, Gap, Cumplimiento Anual) se calcula aquí y no se lee.
 */
export function leerCumplimientos(hojas: Record<string, readonly (readonly Celda[])[]>): { meses: MesOficial[]; avisos: string[] } {
  const meses: MesOficial[] = [];
  const avisos: string[] = [];
  for (const [nombre, filas] of Object.entries(hojas)) {
    const anio = /(20\d{2})/.exec(nombre)?.[1];
    if (!anio) continue;
    let campaign: CampaignCode | null = null;
    let columnas: Map<number, number> | null = null;
    for (const fila of filas) {
      const primera = norm(texto(fila.find((c) => texto(c).trim()) ?? ""));
      const j0 = fila.findIndex((c) => texto(c).trim());
      if (!primera) continue;
      if (primera === "mes") {
        columnas = new Map();
        fila.forEach((c, j) => {
          const m = j > j0 ? numeroDeMes(c) : null;
          if (m) columnas!.set(j, m);
        });
        continue;
      }
      // Título de bloque: el nombre de la campaña solo en la fila.
      const resto = fila.slice(j0 + 1).some((c) => c !== null && c !== undefined && c !== "");
      const camp = !resto ? campanaDeTitulo(primera) : null;
      if (!resto) {
        campaign = camp;
        columnas = null;
        if (!camp) avisos.push(`Hoja ${nombre}: no reconocí la campaña "${texto(fila[j0])}"; ese bloque no se leyó.`);
        continue;
      }
      if (!campaign || !columnas) continue;
      const tipo = primera.startsWith("meta") ? "meta" : primera.startsWith("real") ? "real" : null;
      if (!tipo) continue;
      for (const [j, m] of columnas) {
        const month = `${anio}-${String(m).padStart(2, "0")}`;
        const v = numero(fila[j]);
        let e = meses.find((x) => x.campaign === campaign && x.month === month);
        if (!e) meses.push((e = { campaign, month, meta: null, real: null }));
        e[tipo] = v;
      }
    }
  }
  // Solo los meses con algún dato (los que vienen vacíos o con #DIV/0! no se guardan).
  return { meses: meses.filter((m) => m.meta !== null || m.real !== null).sort((a, b) => a.campaign.localeCompare(b.campaign) || a.month.localeCompare(b.month)), avisos };
}

/** Une lo guardado con lo nuevo: los meses del archivo nuevo reemplazan a los mismos meses de antes. */
export function unirOficial(antes: readonly MesOficial[], nuevo: readonly MesOficial[]): MesOficial[] {
  const k = (m: MesOficial) => `${m.campaign}|${m.month}`;
  const map = new Map(antes.map((m) => [k(m), m]));
  for (const m of nuevo) map.set(k(m), m);
  return [...map.values()].sort((a, b) => a.campaign.localeCompare(b.campaign) || a.month.localeCompare(b.month));
}
