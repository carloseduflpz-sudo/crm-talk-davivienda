/* Utilidades de fechas para la pantalla. La lectura del Excel vive en excel.ts (en segundo plano). */

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** "2026-09" → "septiembre 2026" */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1] ?? ym} ${y ?? ""}`.trim();
}

/** Mes de hoy (AAAA-MM) en la hora local: el último día del mes en la noche sigue siendo ese mes. */
export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

const MONTH_WORDS: string[][] = [
  ["enero", "ene"], ["febrero", "feb"], ["marzo", "mar"], ["abril", "abr"], ["mayo", "may"], ["junio", "jun"],
  ["julio", "jul"], ["agosto", "ago"], ["septiembre", "setiembre", "sept", "sep"], ["octubre", "oct"], ["noviembre", "nov"], ["diciembre", "dic"],
];

/**
 * Mes (AAAA-MM) que dice el nombre de un archivo: "TC Primeras Cuentas Octubre", "Base_BAU_Oct26", "Sep 2026".
 * Sin año, el más reciente que no quede en el futuro (con un mes de margen). null si no dice ningún mes.
 */
export function monthFromName(fileName: string, now = new Date()): string | null {
  const s = fileName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, "");
  for (let i = 0; i < 12; i++) {
    for (const w of MONTH_WORDS[i]!) {
      const m = new RegExp(`(^|[^a-z])${w}(?![a-z])[\\s_.-]*(20\\d{2}|\\d{2}(?!\\d))?`).exec(s);
      if (!m) continue;
      const month = i + 1;
      let year = m[2] ? Number(m[2].length === 2 ? `20${m[2]}` : m[2]) : Number(/(^|[^0-9])(20\d{2})([^0-9]|$)/.exec(s)?.[2] ?? 0);
      if (!year) {
        year = now.getFullYear();
        if (month > now.getMonth() + 2) year--;
      }
      return `${year}-${String(month).padStart(2, "0")}`;
    }
  }
  return null;
}
