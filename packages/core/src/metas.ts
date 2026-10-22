/* Reglas de la meta de cada mes.
   - Para la meta solo cuenta lo que el banco ya entregó, desembolsó, aplicó o activó (según la sábana).
     Cada mes se puede ajustar qué estatus cuentan; por defecto se usan los de esta lista.
   - El ritmo y la proyección se calculan en DÍAS HÁBILES: días de la semana que se trabajan,
     sin los feriados del mes. */
import type { CampaignCode } from "./campaigns";

/** Cómo se mide la meta: en número de ventas o en dólares (CDC y Extra se miden por monto). */
export type GoalUnit = "ventas" | "monto";
export const GOAL_UNIT: Record<CampaignCode, GoalUnit> = { tdc: "ventas", extrafin: "monto", cdc: "monto", upin: "ventas", seguros: "ventas", domi: "ventas" };

/** Estatus de la sábana que cuentan para la meta, por campaña (se comparan por inicio: "ENTREGADA POR COURIER" cuenta). */
export const GOAL_STATUS_PREFIXES: Record<CampaignCode, readonly string[]> = {
  tdc: ["ENTREGAD"],
  extrafin: ["ENTREGAD", "DESEMBOLSAD"],
  cdc: ["APLICAD"],
  upin: ["APLICAD"],
  seguros: ["ACTIV"],
  domi: ["EXITOS", "ACTIV"],
};

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();

/** ¿Este estatus cuenta para la meta por defecto? */
export function countsForGoal(campaign: CampaignCode, status: string): boolean {
  const s = norm(status);
  return GOAL_STATUS_PREFIXES[campaign].some((p) => s.startsWith(p));
}

/** Días de la semana: 0 = domingo … 6 = sábado. Por defecto, de lunes a viernes. */
export const DEFAULT_WORK_DAYS: readonly number[] = [1, 2, 3, 4, 5];

const pad = (n: number) => String(n).padStart(2, "0");
export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();

/** Fechas hábiles del mes (AAAA-MM-DD), en orden. */
export function businessDays(month: string, workDays: readonly number[], holidays: readonly string[]): string[] {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const off = new Set(holidays);
  const out: string[] = [];
  for (let d = 1; d <= daysInMonth(month); d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (workDays.includes(wd) && !off.has(iso)) out.push(iso);
  }
  return out;
}

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
function easter(y: number): Date {
  const a = y % 19,
    b = Math.floor(y / 100),
    c = y % 100,
    d = Math.floor(b / 4),
    e = b % 4,
    f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30,
    i = Math.floor(c / 4),
    k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7,
    m = Math.floor((a + 11 * h + 22 * l) / 451),
    month = Math.floor((h + l - 7 * m + 114) / 31),
    day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, month - 1, day));
}

/** Feriados nacionales de El Salvador que caen en el mes (sugerencia; cada mes se confirma en la meta). */
export function suggestedHolidays(month: string): { date: string; name: string }[] {
  const y = Number(month.slice(0, 4));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const e = easter(y);
  const shift = (days: number) => iso(new Date(e.getTime() + days * 86_400_000));
  const list = [
    { date: `${y}-01-01`, name: "Año Nuevo" },
    { date: shift(-3), name: "Jueves Santo" },
    { date: shift(-2), name: "Viernes Santo" },
    { date: shift(-1), name: "Sábado Santo" },
    { date: `${y}-05-01`, name: "Día del Trabajo" },
    { date: `${y}-05-10`, name: "Día de la Madre" },
    { date: `${y}-06-17`, name: "Día del Padre" },
    { date: `${y}-08-06`, name: "Fiestas Agostinas" },
    { date: `${y}-09-15`, name: "Día de la Independencia" },
    { date: `${y}-11-02`, name: "Día de los Difuntos" },
    { date: `${y}-12-25`, name: "Navidad" },
  ];
  return list.filter((h) => h.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));
}
