/* Cuadre contra el Excel de control (el "DAVIVIENDA_<mes>.xlsx" de las gráficas): se lee la hoja TALK
   (meta, HC, días del mes y días transcurridos) y la hoja de cada campaña (meta MTD, resultado,
   Cantado vs Activo y contacto) y se compara cifra por cifra con lo que calcula la app, diciendo de
   dónde sale cada número de la app para que se vea en qué paso está la diferencia. */
import type { CampaignCode } from "./campaigns";
import { campanaDeTitulo, contactoDe, grupoDeTexto, resumenGrupo, type PresDatos, type PresentacionCampania } from "./presentacion";

export type Celda = string | number | boolean | Date | null | undefined;
export type Hoja = Celda[][];

export interface ControlCampania {
  campaign: CampaignCode;
  nombre: string;
  hc: number | null;
  meta: number | null;
  metaMTD: number | null;
  metaSemanal: number | null;
}

export type DatoHoja = "metaMTD" | "resultado" | "cumplimiento" | "unicos" | "recorridos" | "nuevo" | "cantadas" | "activas";

export interface ControlHoja {
  hoja: string;
  campaign: CampaignCode;
  /** Base a la que se refiere la hoja (primeras, segundas, Bau…); null = toda la campaña. */
  grupo: string | null;
  valores: Partial<Record<DatoHoja, number>>;
  contacto: { label: string; n: number }[];
}

export interface ControlExcel {
  diasMes: number | null;
  diasMTD: number | null;
  campanas: ControlCampania[];
  hojas: ControlHoja[];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
const isText = (c: Celda): c is string => typeof c === "string" && c.trim() !== "";
const num = (c: Celda): number | null => {
  if (typeof c === "number" && Number.isFinite(c)) return c;
  if (typeof c === "string" && /^\s*-?[\d,]+(\.\d+)?\s*$/.test(c)) return Number(c.replace(/,/g, ""));
  return null;
};
/** Primer número a la derecha de la columna `j`. */
const numRight = (row: Celda[], j: number): number | null => {
  for (let k = j + 1; k < row.length; k++) {
    const v = num(row[k]);
    if (v !== null) return v;
    if (isText(row[k])) return null;
  }
  return null;
};
const firstText = (row: Celda[]): { j: number; t: string } | null => {
  const j = row.findIndex(isText);
  return j < 0 ? null : { j, t: String(row[j]) };
};

const LABELS: Record<string, DatoHoja> = {
  "meta mtd": "metaMTD",
  resultado: "resultado",
  cumplimiento: "cumplimiento",
  "registros unicos": "unicos",
  "registros recorridos": "recorridos",
  nuevo: "nuevo",
  nuevos: "nuevo",
  "ventas cantadas": "cantadas",
  "ventas activas": "activas",
};

/** El nombre de la hoja con espacios entre letras y números: "TARCRED_1CTS" → "tarcred 1 cts". */
const hojaLegible = (s: string) =>
  s
    .replace(/[_\-.]+/g, " ")
    .replace(/(\d)([a-z])/gi, "$1 $2")
    .replace(/([a-z])(\d)/gi, "$1 $2");

/** Lee el Excel de control. `hojas`: cada hoja como filas de celdas (valores ya calculados). */
export function leerControl(hojas: Record<string, Hoja>): ControlExcel {
  const out: ControlExcel = { diasMes: null, diasMTD: null, campanas: [], hojas: [] };
  for (const [nombre, filas] of Object.entries(hojas)) {
    // Hoja TALK: tabla con columnas HC y Meta, y arriba los días del mes y los transcurridos (MTD).
    const h = filas.findIndex((r) => r.some((c) => isText(c) && norm(c) === "hc") && r.some((c) => isText(c) && norm(c) === "meta"));
    if (h >= 0) {
      const head = filas[h]!.map((c) => (isText(c) ? norm(c) : ""));
      const col = (k: string) => head.findIndex((x) => x === k);
      for (const r of filas.slice(0, h)) {
        r.forEach((c, j) => {
          if (!isText(c)) return;
          if (norm(c) === "dias") out.diasMes ??= numRight(r, j);
          if (norm(c) === "mtd") out.diasMTD ??= numRight(r, j);
        });
      }
      for (const r of filas.slice(h + 1)) {
        const name = firstText(r);
        if (!name || name.j >= col("hc")) break;
        const campaign = campanaDeTitulo(name.t);
        if (!campaign) continue;
        const v = (k: string) => (col(k) >= 0 ? num(r[col(k)]) : null);
        out.campanas.push({ campaign, nombre: name.t.trim(), hc: v("hc"), meta: v("meta"), metaMTD: v("meta mtd"), metaSemanal: v("meta semanal") });
      }
      continue;
    }
    // Hoja de campaña: el título (primera celda con texto) dice la campaña; el nombre de la hoja, la base.
    const titulo = filas.slice(0, 3).map(firstText).find(Boolean)?.t ?? "";
    const campaign = campanaDeTitulo(titulo) ?? campanaDeTitulo(hojaLegible(nombre));
    if (!campaign) continue;
    const hoja: ControlHoja = { hoja: nombre, campaign, grupo: grupoDeTexto(campaign, hojaLegible(nombre)), valores: {}, contacto: [] };
    for (let i = 0; i < filas.length; i++) {
      const r = filas[i]!;
      r.forEach((c, j) => {
        if (!isText(c)) return;
        const key = LABELS[norm(c)];
        if (key && hoja.valores[key] === undefined) {
          const v = numRight(r, j);
          if (v !== null) hoja.valores[key] = v;
        }
        // Tabla de contacto: debajo de "Categoria", una fila por categoría hasta la primera vacía.
        if (norm(c) === "categoria" && !hoja.contacto.length) {
          for (const rr of filas.slice(i + 1)) {
            const l = rr[j];
            if (!isText(l)) break;
            const v = numRight(rr, j);
            if (v !== null) hoja.contacto.push({ label: l.trim(), n: v });
          }
        }
      });
    }
    if (Object.keys(hoja.valores).length || hoja.contacto.length) out.hojas.push(hoja);
  }
  return out;
}

/* ---------- cuadre ---------- */

export type Formato = "entero" | "dinero" | "porcentaje";

export interface CuadreFila {
  campaign: CampaignCode;
  /** Hoja del Excel (o "TALK" para meta, HC y días). */
  hoja: string;
  dato: string;
  excel: number | null;
  app: number | null;
  formato: Formato;
  cuadra: boolean;
  /** De dónde sale el número de la app (se muestra cuando no cuadra). */
  como: string;
  /** De dónde lo toma la presentación: del Excel (M, R, contacto, meta, HC, días) o lo calcula la app. */
  enPresentacion: "excel" | "app";
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const dia = (iso: string) => `${Number(iso.slice(8, 10))} de ${MESES[Number(iso.slice(5, 7)) - 1]}`;

function iguales(a: number | null, b: number | null, f: Formato): boolean {
  if (a === null || b === null) return false;
  if (f === "porcentaje") return Math.abs(a - b) < 0.5;
  return Math.round(a) === Math.round(b);
}

export function cuadrarControl(ctrl: ControlExcel, datos: PresDatos): CuadreFila[] {
  const out: CuadreFila[] = [];
  const add = (d: PresentacionCampania, hoja: string, dato: string, excel: number | null | undefined, app: number | null, formato: Formato, como: string) => {
    if (excel === undefined || excel === null) return;
    const enPresentacion =
      hoja === "TALK" || ["Resultado", "Cumplimiento MTD", "Registros recorridos", "Nuevo"].includes(dato) || dato.startsWith("Contacto:") ? "excel" : "app";
    out.push({ campaign: d.campaign, hoja, dato, excel, app, formato, cuadra: iguales(excel, app, formato), como, enPresentacion });
  };
  const dinero = (d: PresentacionCampania): Formato => (d.unidad === "monto" ? "dinero" : "entero");

  for (const c of ctrl.campanas) {
    const d = datos[c.campaign];
    if (!d) continue;
    const metas = `la meta que guardaste en Metas para ${MESES[Number(d.month.slice(5, 7)) - 1]}`;
    add(d, "TALK", "Meta del mes", c.meta, d.meta, dinero(d), `Es ${metas}. Si no es la de tu Excel, corrígela ahí.`);
    add(d, "TALK", "HC (agentes)", c.hc, d.hc, "entero", `Es el número de agentes que guardaste con la meta (en Metas).`);
    add(d, "TALK", "Días hábiles del mes", ctrl.diasMes, d.diasHabiles.total, "entero", "La app cuenta lunes a viernes menos los feriados que pusiste en Metas.");
    add(
      d,
      "TALK",
      "Días hábiles transcurridos",
      ctrl.diasMTD,
      d.diasHabiles.transcurridos,
      "entero",
      d.fechaCorte ? `La app cuenta los días hábiles hasta la última venta del mes en la sábana: el ${dia(d.fechaCorte)}.` : "No hay sábana del mes: la app no tiene días transcurridos.",
    );
    const metaMTD = c.metaMTD ?? (c.meta !== null && ctrl.diasMes && ctrl.diasMTD !== null ? (c.meta / ctrl.diasMes) * ctrl.diasMTD : null);
    add(d, "TALK", "Meta MTD", metaMTD, d.esperado, dinero(d), "Meta del mes ÷ días hábiles del mes × días hábiles transcurridos (los de arriba).");
  }

  for (const h of ctrl.hojas) {
    const d = datos[h.campaign];
    if (!d) continue;
    const r = resumenGrupo(d, h.grupo);
    const v = h.valores;
    const base = h.grupo ? `la base ${h.grupo.split(":").pop()}` : d.bases.length > 1 ? "las bases del mes" : "la base del mes";
    const sinBase = "No hay base cargada de este mes para esta hoja.";
    const sinSabana = "No hay sábana del mes.";
    if (!h.grupo) {
      add(d, h.hoja, "Resultado", v.resultado, d.resultado, dinero(d), "Ventas de la sábana con los estatus que cuentan para la meta (se eligen en Metas) más la cosecha que se activó este mes.");
      if (v.cumplimiento !== undefined) {
        const app = d.esperado ? (d.resultado / d.esperado) * 100 : null;
        add(d, h.hoja, "Cumplimiento MTD", v.cumplimiento <= 5 ? v.cumplimiento * 100 : v.cumplimiento, app, "porcentaje", "Resultado ÷ meta MTD.");
      }
    }
    add(d, h.hoja, "Registros únicos", v.unicos, r.bases ? r.unicos : null, "entero", r.bases ? `Clientes distintos de ${base}.` : sinBase);
    add(
      d,
      h.hoja,
      "Registros recorridos",
      v.recorridos,
      r.bases ? r.recorridos : null,
      "entero",
      r.bases ? `Clientes de ${base} con al menos una llamada en las tipificaciones del mes (también las que VICI dejó sin NIU y se unieron por teléfono).` : sinBase,
    );
    add(d, h.hoja, "Nuevo", v.nuevo, r.bases ? r.nuevo : null, "entero", r.bases ? "Registros únicos − recorridos." : sinBase);
    const hay = d.ventas.length > 0;
    add(d, h.hoja, "Ventas cantadas", v.cantadas, hay ? r.cantadas : null, dinero(d), hay ? "Ventas del mes en la sábana (cualquier estatus) más la cosecha que se activó." : sinSabana);
    add(d, h.hoja, "Ventas activas", v.activas, hay ? r.activas : null, dinero(d), hay ? "Ventas con los estatus que cuentan para la meta (en Metas) más la cosecha que se activó." : sinSabana);
    if (h.contacto.length) {
      const app = contactoDe(d, h.grupo, h.contacto.map((x) => x.label));
      for (const x of h.contacto) {
        const key = [...app.keys()].find((k) => norm(k) === norm(x.label));
        add(d, h.hoja, `Contacto: ${x.label}`, x.n, r.bases ? (key ? app.get(key)! : 0) : null, "entero", r.bases ? `Clientes de ${base} cuya última llamada del mes quedó en "${x.label}".` : sinBase);
      }
    }
  }
  return out;
}

/** Base que cuenta como "la base" de la campaña cuando tiene varias (las demás van en tablas aparte). */
const BASE_PRINCIPAL: Partial<Record<CampaignCode, string>> = { domi: "domi:base:domi", cdc: "cdc:base:cdc" };

/** Hoja principal de una campaña en el Excel: la de toda la campaña o, si no hay, la de su base principal (p. ej. DOMI-Bau). */
function hojaPrincipal(ctrl: ControlExcel, code: CampaignCode): ControlHoja | undefined {
  const hs = ctrl.hojas.filter((h) => h.campaign === code);
  return hs.find((h) => h.grupo === null) ?? hs.find((h) => h.valores.resultado !== undefined);
}

/**
 * Lo que la presentación toma del Excel de las gráficas: la M (meta MTD), la R (resultado) y las gráficas
 * de contacto. Con la M y la R salen también el cumplimiento y la fila del trimestre del gap; el HC del Excel
 * reparte la M entre los agentes. Todo lo demás sigue saliendo de la sábana, las bases y las tipificaciones.
 */
/** Días hábiles de atraso desde los que el Excel de las gráficas se considera de otra semana. */
export const EXCEL_ATRASADO = 3;

export function aplicarControl(datos: PresDatos, ctrl: ControlExcel): PresDatos {
  const out: PresDatos = {};
  for (const [code, d] of Object.entries(datos) as [CampaignCode, PresentacionCampania][]) {
    const c = ctrl.campanas.find((x) => x.campaign === code);
    const h = hojaPrincipal(ctrl, code);
    if (!c && !h) {
      out[code] = d;
      continue;
    }
    const meta = c?.meta ?? d.meta;
    const hc = c?.hc ?? d.hc;
    /* ¿El Excel está al día? Si la sábana ya va 3 o más días hábiles adelante del Excel (el Excel es de la semana
       pasada), su M, su R y su contacto ya no son los de hoy: se calculan con lo cargado y se avisa. Una diferencia de
       1 o 2 días es normal (cómo se cuenta el día del corte) y se respeta el Excel. La meta del mes y el HC sí se
       toman del Excel (no cambian en la semana). */
    if (ctrl.diasMTD !== null && d.diasHabiles.transcurridos - ctrl.diasMTD >= EXCEL_ATRASADO) {
      const { total: t, transcurridos: tr } = d.diasHabiles;
      const esperado = meta !== null && t ? (meta / t) * tr : d.esperado;
      out[code] = {
        ...d,
        meta,
        hc,
        esperado,
        avisoExcel: `Tu Excel de las gráficas llega al día hábil ${ctrl.diasMTD} y la sábana al ${tr}: la M, la R y el contacto se calcularon con lo cargado. Si quieres usar los de tu Excel, súbelo actualizado.`,
        trimestre: d.trimestre.map((x) => (x.month === d.month ? { ...x, meta: esperado, metaPorAgente: esperado !== null && hc ? esperado / hc : x.metaPorAgente } : x)),
      };
      continue;
    }
    const total = ctrl.diasMes ?? d.diasHabiles.total;
    const trans = ctrl.diasMTD ?? d.diasHabiles.transcurridos;
    const m = h?.valores.metaMTD ?? c?.metaMTD ?? (meta !== null && total ? (meta / total) * trans : null);
    const r = h?.valores.resultado ?? d.resultado;
    const contactoExcel: Record<string, { label: string; n: number }[]> = {};
    for (const x of ctrl.hojas) if (x.campaign === code && x.contacto.length) contactoExcel[x.grupo ?? "*"] = x.contacto;
    // Registros recorridos de cada base, también del Excel (así "Nuevo" y la gráfica de contacto cuadran entre sí).
    const recorridos = new Map<string, number>();
    const hojas = ctrl.hojas.filter((x) => x.campaign === code && x.valores.recorridos !== undefined);
    for (const x of hojas) if (x.grupo && d.bases.some((b) => b.dataset === x.grupo)) recorridos.set(x.grupo, x.valores.recorridos!);
    const general = hojas.find((x) => !x.grupo);
    if (general) {
      const principal = d.bases.length === 1 ? d.bases[0]!.dataset : BASE_PRINCIPAL[code];
      if (principal && d.bases.some((b) => b.dataset === principal) && !recorridos.has(principal)) recorridos.set(principal, general.valores.recorridos!);
    }
    out[code] = {
      ...d,
      bases: d.bases.map((b) => (recorridos.has(b.dataset) ? { ...b, recorridos: recorridos.get(b.dataset)! } : b)),
      meta,
      hc,
      diasHabiles: { total, transcurridos: trans },
      esperado: m,
      resultado: r,
      mrDeExcel: true,
      contactoExcel: Object.keys(contactoExcel).length ? contactoExcel : d.contactoExcel,
      trimestre: d.trimestre.map((t) => (t.month === d.month ? { ...t, meta: m, resultado: r, metaPorAgente: m !== null && hc ? m / hc : t.metaPorAgente } : t)),
    };
  }
  return out;
}
