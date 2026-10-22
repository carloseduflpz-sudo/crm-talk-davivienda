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
