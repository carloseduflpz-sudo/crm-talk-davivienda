/* Presentación semanal: se toma la presentación de la semana anterior (la plantilla) y se cambian SOLO sus
   cifras con lo último que tiene cargado la herramienta. El diseño, los colores, las imágenes, las láminas
   de CDC, Extra y Seguros y todo lo que la herramienta no sabe calcular se queda exactamente igual.

   Cada tabla y gráfica se reconoce por lo que dice (encabezados, títulos), no por su número de lámina,
   así que se puede mover, quitar o agregar láminas sin romper nada. */
import type { CampaignCode } from "./campaigns";
import { nameTokens } from "./agentes";
import { datasetsPrincipales, extremos, segmentosConversion, type PresSegmentoFila } from "./segmentos";
import { type Pptx, chartTitle, fillChart, fillTable, readChart, readTables, replaceExactText, texts } from "./pptx";

/* ---------- datos que entrega el servidor (uno por campaña) ---------- */

export interface PresConteo {
  label: string;
  n: number;
}

export interface PresBase {
  dataset: string;
  /** Clientes únicos de la base del mes. */
  unicos: number;
  /** Clientes de la base con al menos una llamada en VICI en el mes. */
  recorridos: number;
  /** Clientes de la base con contacto efectivo (regla de la campaña). */
  contactados: number;
  /** Llamadas hechas a clientes de esta base. */
  llamadas: number;
  /** Clientes recorridos con una sola llamada. */
  unIntento: number;
  /** Clientes de la base con una venta del mes en la sábana (cualquier estatus). */
  conVenta: number;
  /** Monto de esas ventas (CDC y Extra). */
  montoVenta: number;
  /** Categoría de la ÚLTIMA llamada de cada cliente recorrido. */
  contacto: PresConteo[];
  /** Clientes únicos de esta misma base el mes anterior (para las tablas de cosecha). */
  mesAnterior: number | null;
}

export interface PresVenta {
  /** Base a la que pertenece la venta (p. ej. "tdc:base:primeras"); null si no se sabe. */
  grupo: string | null;
  /** "mes" = vendida este mes; "cosecha" = vendida en un mes anterior. */
  origen: "mes" | "cosecha";
  estatus: string;
  /** 1 = cuenta para la meta este mes; 0 = no cuenta; 2 = ya contó en la meta de un mes anterior. */
  k: 0 | 1 | 2;
  proceso: string;
  /** Semana del mes de la fecha de venta (1 = del día 1 al primer domingo). */
  semana: number | null;
  ops: number;
  /** Clientes distintos del grupo. */
  clientes: number;
  valor: number;
}

export interface PresDocumento {
  /** Cuántas ventas tienen esta misma combinación. */
  n: number;
  estatus: string;
  /** Columna DOCUMENTACION de la sábana. */
  doc: string | null;
  /** Columna PENDIENTE POR REQUISITO. */
  pendiente: string | null;
  /** RECHAZO HOMOLOGADO. */
  motivo: string | null;
}

export interface PresMotivo {
  tipologia: string;
  subtipologia: string;
  n: number;
}

export interface PresMesGap {
  month: string;
  /** Meta del mes. En el mes en curso es la meta MTD: lo esperado a los días hábiles que lleva la sábana. */
  meta: number | null;
  metaPorAgente: number | null;
  /** true si `meta` y `metaPorAgente` son MTD (mes en curso). */
  mtd: boolean;
  resultado: number;
  porAgente: { agent: string; ventas: number }[];
  /** Agentes que trabajaron el mes (sábana, VICI o CRM), vendieran o no. */
  agentes: string[];
}

export interface PresentacionCampania {
  campaign: CampaignCode;
  month: string;
  unidad: "ventas" | "monto";
  meta: number | null;
  /** Número de agentes (HC) que se puso con la meta. */
  hc: number | null;
  /** Meta MTD: la meta repartida en los días hábiles del mes hasta el último día con ventas en la sábana. */
  esperado: number | null;
  /** Días hábiles transcurridos (hasta la fecha de corte de la sábana) y días hábiles del mes. */
  diasHabiles: { transcurridos: number; total: number };
  /** Lo que cuenta para la meta (ventas activas del mes + cosecha). */
  resultado: number;
  fechaCorte: string | null;
  /** Ventas con fecha posterior al día en que se cargó la sábana: no se usaron para el corte. */
  fechasPosteriores: { filas: number; hasta: string } | null;
  bases: PresBase[];
  /** Remanente: clientes de la base del mes anterior que no vienen en la de este mes (llamadas y ventas de este mes). */
  remanentes?: PresBase[];
  /** Clientes de la base principal por valor de cada columna (gráfica "Conversión por segmento"). */
  segmentos?: PresSegmentoFila[];
  ventas: PresVenta[];
  motivos: PresMotivo[];
  /** Meses del trimestre hasta el mes elegido (para las láminas de gap). */
  trimestre: PresMesGap[];
  /** Clientes distintos con una venta que cuenta (DOMI: clientes contra colectores), en total y por semana del mes. */
  clientesActivos?: { total: number; porSemana: Record<string, number> };
  /** TDC: ventas de la sábana (del mes y cosecha) agrupadas por estatus, documentos y motivo de rechazo. */
  documentos?: PresDocumento[];
  /** Gráficas de contacto tomadas del Excel de las gráficas, por base ("*" = toda la campaña). */
  contactoExcel?: Record<string, PresConteo[]>;
}

export type PresDatos = Partial<Record<CampaignCode, PresentacionCampania>>;

/* ---------- resultado ---------- */

export interface PresCambio {
  lamina: number;
  titulo: string;
  bloque: string;
  dato: string;
  antes: string;
  ahora: string;
}

export interface PresSinCambio {
  lamina: number;
  titulo: string;
  bloque: string;
  motivo: string;
}

export interface PresResultado {
  cambios: PresCambio[];
  sinCambio: PresSinCambio[];
  /** Láminas que se dejaron tal cual (ocultas, de CDC, Extra o Seguros, o sin nada que la herramienta calcule). */
  intactas: { lamina: number; titulo: string; motivo: string }[];
}

export interface PresOpciones {
  /** Mes (AAAA-MM) de los datos de la plantilla: si es el mismo, las semanas ya cerradas se respetan. */
  mesPlantilla: string | null;
  /** Campañas cuyas láminas propias se actualizan (las demás se dejan igual). */
  campanas?: CampaignCode[];
}

/** Campañas cuyas láminas propias se actualizan (todas). */
export const PRES_CAMPANAS: CampaignCode[] = ["tdc", "extrafin", "cdc", "upin", "seguros", "domi"];

/* ---------- utilidades ---------- */

const MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
export const nombreMes = (ym: string) => MESES[Number(ym.slice(5, 7)) - 1] ?? ym;

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Semanas del mes, de lunes a domingo (la primera va del día 1 al primer domingo). */
export function semanasDelMes(month: string): { semana: number; desde: string; hasta: string }[] {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const out: { semana: number; desde: string; hasta: string }[] = [];
  const iso = (d: number) => `${month}-${String(d).padStart(2, "0")}`;
  let start = 1;
  for (let d = 1; d <= days; d++) {
    const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    if (dow === 0 || d === days) {
      out.push({ semana: out.length + 1, desde: iso(start), hasta: iso(d) });
      start = d + 1;
    }
  }
  return out;
}

/** Semana del mes de una fecha AAAA-MM-DD (null si no es de ese mes). */
export function semanaDe(month: string, date: string | null): number | null {
  if (!date || !date.startsWith(month)) return null;
  const d = date.slice(0, 10);
  return semanasDelMes(month).find((w) => d >= w.desde && d <= w.hasta)?.semana ?? null;
}

/** Escribe `value` con el mismo estilo que `old` ("1,264", "2942", "47.3%", "$202,872.96", "2.2"). */
export function comoAntes(old: string, value: number, opts: { porcentaje?: boolean; comas?: boolean } = {}): string {
  const o = old.trim();
  const money = o.startsWith("$") || o.startsWith("-$");
  const pct = opts.porcentaje ?? o.endsWith("%");
  // Dinero sin centavos en la plantilla ("$0", "$92,374"): sin centavos si la cifra es entera.
  const dec = /\.(\d+)/.exec(o.replace(/[%$,]/g, ""))?.[1]?.length ?? (money && !Number.isInteger(Math.round(value * 100) / 100) ? 2 : 0);
  const commas = opts.comas ?? (money || /\d,\d{3}/.test(o));
  const fmt = (v: number) => {
    const fixed = Math.abs(v).toFixed(dec);
    const [int, frac] = fixed.split(".") as [string, string | undefined];
    const i = commas ? int.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : int;
    return (v < 0 && Number(fixed) !== 0 ? "-" : "") + (money ? "$" : "") + i + (frac ? "." + frac : "");
  };
  return fmt(value) + (pct ? "%" : "");
}

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .replace(/(^|[\s/(-])([a-záéíóúñü])/g, (_, a: string, b: string) => a + b.toUpperCase());

/** Etiqueta para un estatus o motivo: la que ya usaba la plantilla si es el mismo, o el texto del archivo ordenado. */
function etiqueta(raw: string, plantilla: string[]): string {
  const k = norm(raw);
  const hit = plantilla.find((p) => norm(p) === k);
  if (hit) return hit;
  return raw === raw.toUpperCase() ? titleCase(raw) : raw.charAt(0).toUpperCase() + raw.slice(1);
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const ratio = (a: number, b: number) => (b ? a / b : 0);

/* ---------- lámina: qué hay en ella ---------- */

interface Frame {
  kind: "tabla" | "grafica" | "smartart" | "otro";
  x: number;
  y: number;
  /** Índice entre las tablas de la lámina (para fillTable). */
  tabla?: number;
  rid?: string;
}

function framesOf(slide: string): Frame[] {
  const out: Frame[] = [];
  let t = 0;
  for (const m of slide.matchAll(/<p:graphicFrame\b[\s\S]*?<\/p:graphicFrame>/g)) {
    const f = m[0];
    const off = /<p:xfrm>\s*<a:off x="(-?\d+)" y="(-?\d+)"/.exec(f);
    const x = Number(off?.[1] ?? 0);
    const y = Number(off?.[2] ?? 0);
    if (/<a:tbl>/.test(f)) out.push({ kind: "tabla", x, y, tabla: t++ });
    else if (/<c:chart\b/.test(f)) out.push({ kind: "grafica", x, y, rid: /<c:chart\b[^>]*r:id="([^"]+)"/.exec(f)?.[1] });
    else if (/<dgm:relIds\b/.test(f)) out.push({ kind: "smartart", x, y, rid: /<dgm:relIds\b[^>]*r:dm="([^"]+)"/.exec(f)?.[1] });
    else out.push({ kind: "otro", x, y });
  }
  return out;
}

/** Campaña de una lámina según su título. */
export function campanaDeTitulo(title: string): CampaignCode | null {
  const t = norm(title);
  if (/upgrade|incremento|upin/.test(t)) return "upin";
  if (/domicili|(^|\s)domi(\s|$)/.test(t)) return "domi";
  if (/compra de cartera|(^|\s)cdc(\s|$)/.test(t)) return "cdc";
  if (/seguro/.test(t)) return "seguros";
  if (/extrafinanc|(^|\s)(extra|ef)(\s|$)/.test(t)) return "extrafin";
  if (/tarjeta|(^|\s)(tdc|tc)(\s|$)/.test(t)) return "tdc";
  return null;
}

/** Grupo (base) que menciona un texto: primeras o segundas cuentas, Bau o Piloto. */
export function grupoDeTexto(campaign: CampaignCode, s: string): string | null {
  const t = norm(s);
  if (campaign === "tdc") {
    if (/(^|\s)1\s*(er|ra|eras|ras)?(\s|$)|primer/.test(t)) return "tdc:base:primeras";
    if (/(^|\s)2\s*(da|das|nda)?(\s|$)|segund/.test(t)) return "tdc:base:segundas";
  }
  if (campaign === "domi") {
    if (/piloto/.test(t)) return "domi:base:piloto";
    if (/(^|\s)bau(\s|$)/.test(t)) return "domi:base:domi";
  }
  if (campaign === "cdc") {
    if (/bienvenida/.test(t)) return "cdc:base:bienvenida";
    if (/(^|\s)bau(\s|$)/.test(t)) return "cdc:base:cdc";
  }
  return null;
}

/** Bases que cuentan como "la base" de la campaña en las tablas generales. */
function basesPrincipales(d: PresentacionCampania): PresBase[] {
  // DOMI y CDC: "la base" es la Bau (la piloto y la de bienvenida van en sus propias tablas).
  const ds = datasetsPrincipales(d.campaign, d.bases.map((b) => b.dataset));
  return d.bases.filter((b) => ds.includes(b.dataset));
}

/** Remanente del mes anterior de las bases principales (clientes que no vienen en la base de este mes). */
function remanentesPrincipales(d: PresentacionCampania): PresBase[] {
  const ds = datasetsPrincipales(d.campaign, d.bases.map((b) => b.dataset));
  return (d.remanentes ?? []).filter((b) => ds.includes(b.dataset));
}

const mesAnteriorDe = (ym: string) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
/** "oct", "sep"… */
const abrevMes = (ym: string) => nombreMes(ym).slice(0, 3).toLowerCase();

/** Ventas sin base del mes (referidos u otra base). */
const SIN_BASE = "__sin_base__";

function basesDe(d: PresentacionCampania, grupo: string | null): PresBase[] {
  return grupo ? d.bases.filter((b) => b.dataset === grupo) : basesPrincipales(d);
}

function ventasDe(d: PresentacionCampania, grupo: string | null): PresVenta[] {
  if (grupo === SIN_BASE) return d.ventas.filter((v) => v.grupo === null);
  return grupo ? d.ventas.filter((v) => v.grupo === grupo) : d.ventas;
}

/** Lo que se suma de cada venta: el número de ventas, o el monto en CDC y Extra. */
const medidaDe = (d: PresentacionCampania) => (v: PresVenta) => (d.unidad === "monto" ? v.valor : v.ops);


/** Estatus agrupados (de mayor a menor) de un conjunto de ventas. */
function porEstatus(vs: PresVenta[], medida: (v: PresVenta) => number = (v) => v.ops): PresConteo[] {
  const m = new Map<string, number>();
  for (const v of vs) m.set(v.estatus, (m.get(v.estatus) ?? 0) + medida(v));
  return [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}

/* ---------- el llenado ---------- */

/** Lo que el llenado necesita de la presentación (Pptx lo cumple; las pruebas usan uno en memoria). */
export type PresDeck = Pick<Pptx, "slides" | "read" | "write" | "rels" | "has">;

interface Ctx {
  deck: PresDeck;
  datos: PresDatos;
  opts: PresOpciones;
  res: PresResultado;
  lamina: number;
  titulo: string;
}

const cambio = (c: Ctx, bloque: string, dato: string, antes: string, ahora: string) => {
  if (antes !== ahora) c.res.cambios.push({ lamina: c.lamina, titulo: c.titulo, bloque, dato, antes, ahora });
};
const omitir = (c: Ctx, bloque: string, motivo: string) => c.res.sinCambio.push({ lamina: c.lamina, titulo: c.titulo, bloque, motivo });

/** Llena la presentación (la modifica en memoria; luego se guarda con deck.save()). */
export async function llenarPresentacion(deck: PresDeck, datos: PresDatos, opts: PresOpciones): Promise<PresResultado> {
  const res: PresResultado = { cambios: [], sinCambio: [], intactas: [] };
  const enabled = new Set(opts.campanas ?? PRES_CAMPANAS);
  const slides = await deck.slides();
  for (let i = 0; i < slides.length; i++) {
    const name = slides[i]!;
    let slide = await deck.read(name);
    const titulo = texts(slide)[0]?.trim() ?? "";
    const c: Ctx = { deck, datos, opts, res, lamina: i + 1, titulo };
    if (/<p:sld\b[^>]*\bshow="0"/.test(slide)) {
      res.intactas.push({ lamina: c.lamina, titulo, motivo: "Lámina oculta" });
      continue;
    }
    const before = res.cambios.length + res.sinCambio.length;
    const tables = readTables(slide);
    const frames = framesOf(slide);
    const rels = await deck.rels(name);

    // Láminas generales (todas las campañas): efectividad de bases y comparativo.
    for (const t of tables) {
      const head = norm(t.cells[0]?.join("|") ?? "");
      try {
        if (/^campana\|base\|recorrido\|contactados\|con venta\|conversion/.test(head)) slide = tablaEfectividad(c, slide, t.index, t.cells);
        else if (/^producto\|contacto talk\|/.test(head)) slide = tablaComparativo(c, slide, t.index, t.cells);
      } catch (e) {
        omitir(c, t.cells[0]?.[0] ?? "Tabla", (e as Error).message);
      }
    }

    // "Seguimiento de documentos" (TDC): documentos pedidos, recuperados y rechazos.
    if (/seguimiento de documentos/.test(norm(titulo)) && enabled.has("tdc")) {
      const t = datos.tdc;
      if (!t?.documentos?.length) omitir(c, "Toda la lámina", "No hay sábana de TDC del mes.");
      else slide = laminaDocumentos(c, t.documentos, slide, tables);
    }

    const campaign = campanaDeTitulo(titulo);
    const d = campaign ? datos[campaign] : undefined;
    if (campaign && enabled.has(campaign)) {
      if (!d) {
        if (tables.length || frames.some((f) => f.kind === "grafica")) omitir(c, "Toda la lámina", "No hay datos cargados de esta campaña para el mes.");
      } else {
        slide = await laminaCampana(c, d, slide, tables, frames, rels);
      }
    }
    if (slide !== (await deck.read(name))) deck.write(name, slide);
    if (res.cambios.length + res.sinCambio.length === before) {
      res.intactas.push({
        lamina: c.lamina,
        titulo,
        motivo: campaign && !enabled.has(campaign) ? "Campaña que se deja igual" : "Nada que la herramienta calcule",
      });
    }
  }
  return res;
}

async function laminaCampana(
  c: Ctx,
  d: PresentacionCampania,
  slide: string,
  tables: ReturnType<typeof readTables>,
  frames: Frame[],
  rels: Awaited<ReturnType<PresDeck["rels"]>>,
): Promise<string> {
  const tableFrames = frames.filter((f) => f.kind === "tabla");
  // Tablas "Cantado vs Activo" (no de cosecha): sirven para saber de qué base es cada gráfica de contacto.
  const cantado: { x: number; grupo: string | null }[] = [];
  for (const t of tables) {
    const h = t.cells[0]?.[0] ?? "";
    if (/^cantado\s+vs\.?\s+activo/i.test(h.trim()) && !/cosecha/i.test(h)) {
      cantado.push({ x: tableFrames.find((f) => f.tabla === t.index)?.x ?? 0, grupo: grupoDeTexto(d.campaign, h.replace(/cantado\s+vs\.?\s+activo/i, "")) });
    }
  }
  const grupoLamina = cantado.length === 1 ? cantado[0]!.grupo : grupoDeTexto(d.campaign, c.titulo);

  for (const t of tables) {
    const h0 = (t.cells[0]?.[0] ?? "").trim();
    const head = norm(t.cells[0]?.join("|") ?? "");
    const block = h0 || "Tabla";
    try {
      if (/^(cantado\s+vs\.?\s+activo|cosecha)/i.test(h0)) slide = tablaCantado(c, d, slide, t.index, t.cells);
      // Referidos / otra base (CDC, DOMI…): ventas de clientes que no están en ninguna base cargada.
      else if (/^referido|otra base/i.test(h0)) slide = tablaCantado(c, d, slide, t.index, t.cells, SIN_BASE);
      else if (/^tipo de desembolso/.test(head)) slide = tablaProceso(c, d, slide, t.index, t.cells);
      else if (/^tipificacion\|cantidad\|%/.test(head)) slide = tablaMotivos(c, d, slide, t.index, t.cells, tituloEncima(slide, tableFrames.find((f) => f.tabla === t.index)));
      else if (/^concepto\|clientes\|%/.test(head)) slide = tablaBase(c, d, slide, t.index, t.cells, grupoLamina);
      else if (/^concepto\|base /.test(head)) slide = tablaBasesTrabajadas(c, d, slide, t.index, t.cells);
      else if (/(^|\|)agente\|antiguedad\|primer trimestre/.test(head)) slide = tablaGapAgentes(c, d, slide, t.index, t.cells);
      else if (/^gap de campana/.test(head)) slide = tablaGapCampana(c, d, slide, t.index, t.cells);
    } catch (e) {
      omitir(c, block, (e as Error).message);
    }
  }

  for (const f of frames) {
    if (!f.rid) continue;
    const target = rels.find((r) => r.id === f.rid)?.target;
    if (!target || !c.deck.has(target)) continue;
    try {
      if (f.kind === "grafica") {
        const chart = await c.deck.read(target);
        // La gráfica de contacto va con la tabla "Cantado vs Activo" que tiene más cerca.
        const near = cantado.length ? [...cantado].sort((a, b) => Math.abs(a.x - f.x) - Math.abs(b.x - f.x))[0]!.grupo : grupoLamina;
        const out = graficaCampana(c, d, chart, near);
        if (out !== chart) await escribirGrafica(c.deck, target, out);
      } else if (f.kind === "smartart") {
        await smartArt(c, d, target, rels);
      }
    } catch (e) {
      omitir(c, f.kind === "grafica" ? `Gráfica ${chartTitle(await c.deck.read(target)) || ""}`.trim() : "Recuadro M/R", (e as Error).message);
    }
  }
  return slide;
}

/* ---------- Cantado vs Activo (y cosecha) ---------- */

const FIJAS = ["registros unicos", "registros recorridos", "nuevo", "nuevos", "ventas cantadas", "ventas cantada", "ventas activas", "cosecha"];
const MES_RE = "(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)";
/** "Activo Octubre", "Activas Octubre", "Ventas Octubre": lo activo de las ventas del mes. */
const esActivoMes = (l: string) => new RegExp(`^(activo|activos|activa|activas|ventas)\\s+${MES_RE}$`).test(norm(l));

function tablaCantado(c: Ctx, d: PresentacionCampania, slide: string, index: number, cells: string[][], grupoFijo?: string): string {
  const h0 = cells[0]![0]!.trim().replace(/\s+/g, " ");
  const esCosecha = /cosecha/i.test(h0);
  const grupo = grupoFijo ?? grupoDeTexto(d.campaign, h0.replace(/cantado\s+vs\.?\s+activo|cosecha/gi, ""));
  if (!grupoFijo && /referido/i.test(h0)) throw new Error("Referidos: la herramienta no recibe ese archivo.");
  const med = medidaDe(d);
  const bases = grupo === SIN_BASE ? [] : basesDe(d, grupo);
  const vs = ventasDe(d, grupo).filter((v) => v.k !== 2);
  const mes = vs.filter((v) => v.origen === "mes");
  const cos = vs.filter((v) => v.origen === "cosecha");
  const activasMes = sum(mes.filter((v) => v.k === 1).map(med));
  const cosechaActivas = sum(cos.filter((v) => v.k === 1).map(med));

  const body = cells.slice(1);
  const isFixed = (l: string) => FIJAS.includes(norm(l)) || esActivoMes(l);
  const fixed = body.filter((r) => isFixed(r[0] ?? ""));
  const dynTpl = body.filter((r) => !isFixed(r[0] ?? ""));
  // ¿Los estatus van todos juntos al final (lista de mayor a menor) o intercalados con las filas fijas?
  const firstDyn = body.findIndex((r) => !isFixed(r[0] ?? ""));
  const intercalados = firstDyn >= 0 && body.slice(firstDyn).some((r) => isFixed(r[0] ?? ""));

  const unicos = esCosecha ? sum(bases.map((b) => b.mesAnterior ?? 0)) : sum(bases.map((b) => b.unicos));
  const recorridos = esCosecha ? unicos : sum(bases.map((b) => b.recorridos));
  if (!bases.length && fixed.some((r) => /registros/.test(norm(r[0] ?? "")))) throw new Error("Falta la base del mes de esta campaña.");
  // Si la tabla no separa las activas (p. ej. "Cantado Vs Activo 1er Cuenta"), los estatus que cuentan van en la lista.
  const separaActivas = fixed.some((r) => norm(r[0] ?? "") === "ventas activas" || esActivoMes(r[0] ?? ""));
  // Cosecha con fila de activas (CDC, Seguros): la lista trae solo lo que no se activó.
  const statusSrc = esCosecha ? (separaActivas ? cos.filter((v) => v.k !== 1) : cos) : separaActivas ? mes.filter((v) => v.k !== 1) : mes;
  const cantadas = esCosecha ? sum(cos.map(med)) : sum(mes.map(med)) + (separaActivas ? cosechaActivas : 0);

  const fixedRow = (r: string[]): string[] => {
    const l = r[0] ?? "";
    const k = norm(l);
    const old = r[1] ?? "";
    let v: number | null = null;
    let label = l;
    if (k === "registros unicos") v = unicos;
    else if (k === "registros recorridos") v = recorridos;
    else if (k === "nuevo" || k === "nuevos") v = unicos - recorridos;
    else if (k === "ventas cantadas" || k === "ventas cantada") v = cantadas;
    else if (k === "ventas activas") v = esCosecha ? cosechaActivas : activasMes + cosechaActivas;
    else if (k === "cosecha") v = cosechaActivas;
    else if (esActivoMes(l)) {
      v = activasMes;
      label = l.replace(/\S+\s*$/, nombreMes(d.month));
      if (l.charAt(0) === l.charAt(0).toLowerCase()) label = label.charAt(0).toLowerCase() + label.slice(1);
    }
    const now = v === null ? old : comoAntes(old || "0", v);
    cambio(c, h0, label, old, now);
    if (label !== l) cambio(c, h0, "Etiqueta", l, label);
    return [label, now];
  };

  const tplLabels = dynTpl.map((r) => r[0] ?? "");
  const conteos = porEstatus(statusSrc, med).map((x) => ({ label: etiqueta(x.label, tplLabels), n: x.n }));
  const comas = cells.some((r) => /\d,\d{3}/.test(r[1] ?? ""));
  const dynRow = (x: { label: string; n: number }, tplValue: string): string[] => {
    const old = dynTpl.find((r) => norm(r[0] ?? "") === norm(x.label))?.[1] ?? "";
    const now = comoAntes(tplValue || "0", x.n, { comas });
    cambio(c, h0, x.label, old || "—", now);
    return [x.label, now];
  };

  const rows: string[][] = [];
  if (intercalados) {
    // Cada estatus de la plantilla se queda en su lugar; los nuevos van al final.
    for (const r of body) {
      if (isFixed(r[0] ?? "")) rows.push(fixedRow(r));
      else rows.push(dynRow({ label: r[0] ?? "", n: conteos.find((x) => norm(x.label) === norm(r[0] ?? ""))?.n ?? 0 }, r[1] ?? ""));
    }
    for (const x of conteos) if (!tplLabels.some((l) => norm(l) === norm(x.label))) rows.push(dynRow(x, dynTpl[0]?.[1] ?? "0"));
  } else {
    // Estatus de mayor a menor en los espacios que tenía la plantilla; si sobran, "Otros".
    for (const r of fixed) rows.push(fixedRow(r));
    const slots = dynTpl.length;
    let dyn = conteos;
    if (slots && dyn.length > slots) {
      dyn = [...dyn.slice(0, slots - 1), { label: tplLabels.find((l) => /^otro/i.test(l)) ?? "Otros", n: sum(dyn.slice(slots - 1).map((x) => x.n)) }];
    } else {
      // Los estatus de la plantilla que esta vez no tienen ventas siguen en 0 (la tabla no cambia de tamaño).
      for (const l of tplLabels) if (dyn.length < slots && !/^otro/i.test(l) && !dyn.some((x) => norm(x.label) === norm(l))) dyn = [...dyn, { label: l, n: 0 }];
    }
    dyn.forEach((x, i) => rows.push(dynRow(x, dynTpl[i]?.[1] ?? "0")));
    for (const r of dynTpl) if (!dyn.some((x) => norm(x.label) === norm(r[0] ?? ""))) cambio(c, h0, r[0] ?? "", r[1] ?? "", "—");
  }
  return fillTable(slide, index, { headerRows: 1, rows });
}

/* ---------- seguimiento de documentos (TDC) ---------- */

const NO_DOC = /^(no|n\/a|na|ninguno|ninguna|-|0|sin documentos?|no requiere.*|no aplica)$/;
const tieneTexto = (v: string | null) => {
  const t = norm(v ?? "");
  return Boolean(t) && !NO_DOC.test(t);
};

/** Llena la lámina con todas las ventas de la sábana de TDC (las del mes y la cosecha). */
function laminaDocumentos(c: Ctx, docs: PresDocumento[], slide: string, tables: ReturnType<typeof readTables>): string {
  // Requiere documento: lo dice la columna DOCUMENTACION (o, si viene vacía en toda la sábana, PENDIENTE POR REQUISITO).
  const usarDoc = docs.some((x) => tieneTexto(x.doc));
  const textoDoc = (x: PresDocumento) => (usarDoc ? x.doc : x.pendiente);
  const cuenta = (xs: PresDocumento[]) => sum(xs.map((x) => x.n));
  const requiereList = docs.filter((x) => tieneTexto(textoDoc(x)));
  // Recuperado: requería documento y ya no está pendiente por requisito.
  const recuperadosList = requiereList.filter((x) => !norm(x.estatus).startsWith("pendiente por requisito"));
  const rechazadasList = docs.filter((x) => norm(x.estatus).startsWith("rechaz"));
  const requieren = { length: cuenta(requiereList) };
  const recuperados = { length: cuenta(recuperadosList) };
  const rechazadas = { length: cuenta(rechazadasList) };
  const total = cuenta(docs);
  const block = "Seguimiento de documentos";
  const pct = (old: string, a: number, b: number) => comoAntes(old || "0%", ratio(a, b) * 100, { porcentaje: true });

  for (const t of tables) {
    const head = norm(t.cells[0]?.join("|") ?? "");
    const cells = t.cells;
    try {
      if (/^cliente pendiente de documento\|clientes recuperados/.test(head) && cells[1]) {
        const r = cells[1];
        const out = [comoAntes(r[0] || "0", requieren.length), comoAntes(r[1] || "0", recuperados.length), pct(r[2] ?? "", recuperados.length, requieren.length)];
        cambio(c, block, "Pendientes de documento · recuperados", r.join(" · "), out.join(" · "));
        slide = fillTable(slide, t.index, { headerRows: 1, rows: [out, ...cells.slice(2)] });
      } else if (/^total de clientes\|no requiere/.test(head) && cells[1]) {
        const r = cells[1];
        const no = total - requieren.length;
        const fila1 = [comoAntes(r[0] || "0", total), comoAntes(r[1] || "0", no), comoAntes(r[2] || "0", requieren.length)];
        const p = cells[2] ?? ["%", "0%", "0%"];
        const fila2 = [p[0] ?? "%", pct(p[1] ?? "", no, total), pct(p[2] ?? "", requieren.length, total)];
        cambio(c, block, "Total · no requiere · requiere", r.join(" · "), fila1.join(" · "));
        slide = fillTable(slide, t.index, { headerRows: 1, rows: cells[2] ? [fila1, fila2] : [fila1] });
      } else if (/^doc\. solicitado\|total/.test(head)) {
        // Cada documento de la plantilla: clientes cuya documentación lo menciona (uno puede pedir varios).
        const rows = cells.slice(1).map((r) => {
          const l = norm(r[0] ?? "");
          const raiz = l.split(" ")[0]!.replace(/s$/, "");
          const n = cuenta(
            requiereList.filter((x) => {
              const txt = norm(`${x.doc ?? ""} ${x.pendiente ?? ""}`);
              return txt.includes(l) || (raiz.length >= 3 && txt.includes(raiz));
            }),
          );
          const now = comoAntes(r[1] || "0", n);
          cambio(c, block, r[0] ?? "", r[1] ?? "", now);
          return [r[0] ?? "", now];
        });
        slide = fillTable(slide, t.index, { headerRows: 1, rows });
      } else if (/^rechazado pcbm/.test(head)) {
        const rows = cells.slice(1).map((r) => {
          const now = comoAntes(r[1] || "0", rechazadas.length);
          cambio(c, block, `Rechazado PCBM · ${r[0] ?? ""}`, r[1] ?? "", now);
          return [r[0] ?? "", now];
        });
        slide = fillTable(slide, t.index, { headerRows: 1, rows });
      } else if (/^motivo de rechazo\|total\|%/.test(head)) {
        const body = cells.slice(1);
        const tplLabels = body.map((r) => r[0] ?? "");
        const m = new Map<string, number>();
        for (const x of rechazadasList) {
          const l = etiqueta(x.motivo ?? "Sin motivo", tplLabels);
          m.set(l, (m.get(l) ?? 0) + x.n);
        }
        const pos = (l: string) => (tplLabels.includes(l) ? tplLabels.indexOf(l) : 999);
        let items = [...m.entries()].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || pos(a.label) - pos(b.label));
        const slots = body.length;
        if (slots && items.length > slots) items = [...items.slice(0, slots - 1), { label: tplLabels.find((l) => /^otro/i.test(l)) ?? "Otros", n: sum(items.slice(slots - 1).map((x) => x.n)) }];
        const rows = items.map((x, i) => {
          const tpl = body[i] ?? body[body.length - 1] ?? ["", "0", "0%"];
          const out = [x.label, comoAntes(tpl[1] || "0", x.n), pct(tpl[2] ?? "", x.n, rechazadas.length)];
          const old = body.find((r) => norm(r[0] ?? "") === norm(x.label));
          cambio(c, "Motivo de rechazo", x.label, old ? `${old[1]} (${old[2]})` : "—", `${out[1]} (${out[2]})`);
          return out;
        });
        if (rows.length) slide = fillTable(slide, t.index, { headerRows: 1, rows });
      }
    } catch (e) {
      omitir(c, cells[0]?.[0] ?? "Tabla", (e as Error).message);
    }
  }
  return slide;
}

/* ---------- activas por proceso (p. ej. "Tipo de Desembolso": Online / Cheque) ---------- */

function tablaProceso(c: Ctx, d: PresentacionCampania, slide: string, index: number, cells: string[][]): string {
  const med = medidaDe(d);
  const act = d.ventas.filter((v) => v.k === 1);
  const procs = [...new Set(act.map((v) => v.proceso))];
  const body = cells.slice(1);
  // Cada fila va con el proceso de la sábana que dice su nombre; la que no se nombra se queda con el proceso que sobra.
  const usados = new Set<string>();
  const asignado = body.map((r) => {
    const k = norm(r[0] ?? "");
    const p = procs.find((x) => norm(x) && (norm(x).startsWith(k) || k.startsWith(norm(x))));
    if (p) usados.add(p);
    return p;
  });
  const sobran = procs.filter((p) => !usados.has(p));
  const sinNombre = asignado.filter((p) => !p).length;
  if (sinNombre > 1 || (sinNombre === 1 && sobran.length !== 1)) throw new Error(`No pude saber a qué proceso de la sábana va cada fila (procesos: ${procs.join(", ") || "ninguno"}).`);
  const h0 = cells[0]![0] ?? "Tabla";
  const rows = body.map((r, i) => {
    const p = asignado[i] ?? sobran[0]!;
    const now = comoAntes(r[1] || "0", sum(act.filter((v) => v.proceso === p).map(med)));
    cambio(c, h0, r[0] ?? "", r[1] ?? "", now);
    return [r[0] ?? "", now];
  });
  return fillTable(slide, index, { headerRows: 1, rows });
}

/* ---------- motivos de no venta ---------- */

/** Texto corto que está justo encima de una tabla (p. ej. "No le interesa" sobre la tabla de motivos). */
function tituloEncima(slide: string, frame: Frame | undefined): string | null {
  if (!frame) return null;
  let best: { t: string; dist: number } | null = null;
  for (const m of slide.matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)) {
    const off = /<a:off x="(-?\d+)" y="(-?\d+)"/.exec(m[0]);
    const t = texts(m[0]).join("").trim();
    if (!off || !t || t.length > 40) continue;
    const dx = Math.abs(Number(off[1]) - frame.x);
    const dy = frame.y - Number(off[2]);
    if (dy <= 0 || dy > 1_500_000 || dx > 1_500_000) continue;
    const dist = dx + dy;
    if (!best || dist < best.dist) best = { t, dist };
  }
  return best?.t ?? null;
}

/** Tipologías de VICI que corresponden a un nombre ("No le interesa" = "No interesa producto"; "No aplica"). */
function tipologiasDe(d: PresentacionCampania, nombre: string): PresMotivo[] {
  const k = norm(nombre);
  const exact = d.motivos.filter((m) => norm(m.tipologia) === k);
  if (exact.length) return exact;
  const parecida = d.motivos.filter((m) => norm(m.tipologia).includes(k) || k.includes(norm(m.tipologia)));
  if (parecida.length) return parecida;
  for (const familia of ["interes", "aplica"]) if (k.includes(familia)) return d.motivos.filter((m) => norm(m.tipologia).includes(familia));
  return [];
}

function tablaMotivos(c: Ctx, d: PresentacionCampania, slide: string, index: number, cells: string[][], titulo: string | null = null): string {
  const total = cells[cells.length - 1]!;
  const tip = total[0] ?? "";
  const body = cells.slice(1, -1);
  // La tipología la dice la fila del total o, si dice solo "Total", el título que está encima de la tabla.
  const nombre = norm(tip) === "total" ? titulo : tip;
  let list = nombre ? tipologiasDe(d, nombre) : [];
  if (!list.length && norm(tip) === "total") {
    // Sin título: la tipología cuyas subtipologías más se parecen a las de la tabla.
    const labels = new Set(body.map((r) => norm(r[0] ?? "")));
    const score = new Map<string, number>();
    for (const m of d.motivos) if (labels.has(norm(m.subtipologia))) score.set(norm(m.tipologia), (score.get(norm(m.tipologia)) ?? 0) + 1);
    const best = [...score.entries()].sort((a, b) => b[1] - a[1]);
    if (best.length && !(best[1] && best[1][1] === best[0]![1])) list = d.motivos.filter((m) => norm(m.tipologia) === best[0]![0]);
  }
  if (!list.length) throw new Error(`No hay llamadas con la tipología "${nombre ?? tip}" en las tipificaciones del mes.`);
  const bloque = nombre ?? list[0]!.tipologia;
  const tplLabels = body.map((r) => r[0] ?? "");
  const m = new Map<string, number>();
  for (const x of list) m.set(x.subtipologia, (m.get(x.subtipologia) ?? 0) + x.n);
  let items = [...m.entries()].map(([label, n]) => ({ label: etiqueta(label, tplLabels), n })).sort((a, b) => b.n - a.n);
  const tot = sum(items.map((x) => x.n));
  const slots = body.length;
  if (slots && items.length > slots) items = [...items.slice(0, slots - 1), { label: tplLabels.find((l) => /^otro/i.test(l)) ?? "Otros motivos", n: sum(items.slice(slots - 1).map((x) => x.n)) }];
  const comas = cells.some((r) => /\d,\d{3}/.test(r[1] ?? ""));
  const rows = items.map((x, i) => {
    const tpl = body[i] ?? body[body.length - 1] ?? ["", "0", "0.0%"];
    const v = comoAntes(tpl[1] || "0", x.n, { comas });
    const p = comoAntes(tpl[2] || "0.0%", ratio(x.n, tot) * 100, { porcentaje: true });
    const old = body.find((r) => norm(r[0] ?? "") === norm(x.label));
    cambio(c, bloque, x.label, old ? `${old[1]} (${old[2]})` : "—", `${v} (${p})`);
    return [x.label, v, p];
  });
  const totV = comoAntes(total[1] || "0", tot, { comas });
  cambio(c, bloque, "Total", total[1] ?? "", totV);
  return fillTable(slide, index, { headerRows: 1, rows, total: [tip, totV, total[2] || "100.0%"] });
}

/* ---------- efectividad de la base ---------- */

interface Efectividad {
  unicos: number;
  recorridos: number;
  contactados: number;
  conVenta: number;
  monto: number;
  llamadas: number;
  unIntento: number;
}

function efectividad(bases: PresBase[]): Efectividad {
  return {
    unicos: sum(bases.map((b) => b.unicos)),
    recorridos: sum(bases.map((b) => b.recorridos)),
    contactados: sum(bases.map((b) => b.contactados)),
    conVenta: sum(bases.map((b) => b.conVenta)),
    monto: sum(bases.map((b) => b.montoVenta)),
    llamadas: sum(bases.map((b) => b.llamadas)),
    unIntento: sum(bases.map((b) => b.unIntento)),
  };
}

function tablaBase(c: Ctx, d: PresentacionCampania, slide: string, index: number, cells: string[][], grupo: string | null): string {
  const bases = basesDe(d, grupo);
  if (!bases.length) throw new Error("Falta la base del mes de esta campaña.");
  const e = efectividad(bases);
  const block = "Efectividad de la base";
  const comas = cells.some((r) => r.some((x) => /\d,\d{3}/.test(x)));
  const n = (old: string, v: number) => comoAntes(old, v, { comas });
  const rows = cells.slice(1).map((r) => {
    const [l = "", a = "", b = ""] = r;
    const k = norm(l);
    let out: [string, string] = [a, b];
    if (k.startsWith("base asignada")) out = [n(a, e.unicos), b];
    else if (k.startsWith("recorrid")) out = [n(a, e.recorridos), comoAntes(b, ratio(e.recorridos, e.unicos) * 100)];
    else if (k.startsWith("contactad")) out = [n(a, e.contactados), comoAntes(b, ratio(e.contactados, e.recorridos) * 100)];
    else if (k.startsWith("con venta")) out = [n(a, e.conVenta), comoAntes(b, ratio(e.conVenta, e.unicos) * 100)];
    else if (k.startsWith("conversion")) out = [a, comoAntes(b || "0.0%", ratio(e.conVenta, e.contactados) * 100)];
    else if (k.startsWith("toques")) out = [comoAntes(a || "0.0", ratio(e.llamadas, e.recorridos)), b];
    else if (k.startsWith("sin llamar")) out = [n(a, e.unicos - e.recorridos), comoAntes(b, ratio(e.unicos - e.recorridos, e.unicos) * 100)];
    else if (k.includes("1 solo intento") || k.includes("un solo intento")) out = [n(a, e.unIntento), comoAntes(b, ratio(e.unIntento, e.recorridos) * 100)];
    cambio(c, block, l, [a, b].filter(Boolean).join(" · "), out.filter(Boolean).join(" · "));
    return [l, out[0], out[1]];
  });
  return fillTable(slide, index, { headerRows: 1, rows });
}

function tablaEfectividad(c: Ctx, slide: string, index: number, cells: string[][]): string {
  const block = "Efectividad de bases";
  const body = cells.slice(1);
  const rows = body.map((r) => {
    const camp = campanaDeTitulo(r[0] ?? "");
    const d = camp ? c.datos[camp] : undefined;
    const bases = d ? basesPrincipales(d) : [];
    if (!d || !bases.length) return { r, conv: Number.parseFloat(r[5] ?? "0") };
    const e = efectividad(bases);
    const conv = ratio(e.conVenta, e.contactados) * 100;
    const venta = d.unidad === "monto" ? comoAntes(r[4]?.startsWith("$") ? r[4] : "$0.00", e.monto) : comoAntes(r[4] ?? "0", e.conVenta, { comas: true });
    const out = [r[0] ?? "", comoAntes(r[1] ?? "0", e.unicos, { comas: true }), comoAntes(r[2] || "0%", ratio(e.recorridos, e.unicos) * 100), comoAntes(r[3] || "0%", ratio(e.contactados, e.recorridos) * 100), venta, comoAntes(r[5] || "0.0%", conv), comoAntes(r[6] || "0.0", ratio(e.llamadas, e.recorridos))];
    cambio(c, block, r[0] ?? "", r.slice(1).join(" · "), out.slice(1).join(" · "));
    return { r: out, conv };
  });
  // De mayor a menor conversión, como en la presentación.
  rows.sort((a, b) => b.conv - a.conv);
  return fillTable(slide, index, { headerRows: 1, rows: rows.map((x) => x.r) });
}

function tablaComparativo(c: Ctx, slide: string, index: number, cells: string[][]): string {
  const block = "Comparativo vs otro canal";
  const pp = (v: number) => `${v > 0 ? "+" : ""}${v} pp`;
  const rows = cells.slice(1).map((r) => {
    const camp = campanaDeTitulo(r[0] ?? "");
    const d = camp ? c.datos[camp] : undefined;
    const grupo = camp ? grupoDeTexto(camp, r[0] ?? "") : null;
    const bases = d ? basesDe(d, grupo) : [];
    if (!d || !bases.length) return r;
    const e = efectividad(bases);
    const cont = Math.round(ratio(e.contactados, e.recorridos) * 100);
    const conv = Math.round(ratio(e.conVenta, e.contactados) * 100);
    const otroC = Number.parseFloat(r[2] ?? "");
    const otroV = Number.parseFloat(r[5] ?? "");
    const out = [r[0] ?? "", `${cont}%`, r[2] ?? "", Number.isFinite(otroC) ? pp(cont - otroC) : (r[3] ?? ""), `${conv}%`, r[5] ?? "", Number.isFinite(otroV) ? pp(conv - otroV) : (r[6] ?? "")];
    cambio(c, block, r[0] ?? "", `${r[1]} · ${r[4]}`, `${out[1]} · ${out[4]}`);
    return out;
  });
  return fillTable(slide, index, { headerRows: 1, rows });
}

/* ---------- bases trabajadas: base del mes contra el remanente del mes anterior (Extra) ---------- */

function tablaBasesTrabajadas(c: Ctx, d: PresentacionCampania, slide: string, index: number, cells: string[][]): string {
  const mesBases = basesPrincipales(d);
  if (!mesBases.length) throw new Error("Falta la base del mes de esta campaña.");
  const rem = remanentesPrincipales(d);
  const cols = [efectividad(mesBases), rem.length ? efectividad(rem) : null] as const;
  const block = "Bases trabajadas";
  const meses = [d.month, mesAnteriorDe(d.month)];
  // Encabezado: "Base oct | Base sep" con los meses de ahora.
  const header = (cells[0] ?? []).map((h, i) => (i === 0 ? h : h.replace(/(\S+)\s*$/, (w) => (w === w.toUpperCase() && w.length > 1 ? abrevMes(meses[i - 1] ?? d.month).toUpperCase() : abrevMes(meses[i - 1] ?? d.month)))));
  header.forEach((h, i) => h !== cells[0]![i] && cambio(c, block, "Encabezado", cells[0]![i]!, h));
  const valor = (e: Efectividad, k: string, old: string): string => {
    if (k.startsWith("clientes en base") || k.startsWith("base asignada")) return comoAntes(old || "0", e.unicos, { comas: true });
    if (k.startsWith("clientes llamados") || k.startsWith("recorrid")) return comoAntes(old || "0", e.recorridos, { comas: true });
    if (k.startsWith("contactad")) return comoAntes(old || "0", e.contactados, { comas: true });
    if (k.startsWith("% contacto")) return comoAntes(old || "0%", ratio(e.contactados, e.recorridos) * 100);
    // "Con venta": en dinero si la celda estaba en dinero; si no, clientes.
    if (k.startsWith("con venta")) return old.trim().startsWith("$") ? comoAntes(old, e.monto) : comoAntes(old || "0", e.conVenta, { comas: true });
    if (k.startsWith("conversion")) return comoAntes(old || "0.0%", ratio(e.conVenta, e.contactados) * 100);
    if (k.startsWith("toques")) return comoAntes(old || "0.0", ratio(e.llamadas, e.recorridos));
    if (k.startsWith("sin llamar")) return comoAntes(old || "0", e.unicos - e.recorridos, { comas: true });
    return old;
  };
  const rows = cells.slice(1).map((r) => {
    const k = norm(r[0] ?? "");
    const out = [r[0] ?? "", ...cols.map((e, i) => (e ? valor(e, k, r[i + 1] ?? "") : "—"))];
    cambio(c, block, r[0] ?? "", r.slice(1).join(" · "), out.slice(1).join(" · "));
    return out;
  });
  if (!rem.length) omitir(c, block, `No hay base de ${nombreMes(meses[1]!).toLowerCase()} cargada: la columna del remanente queda en "—".`);
  let out = fillTable(slide, index, { headerRows: 0, rows: [header, ...rows] });
  // La nota "Base sep: remanente de septiembre llamado en octubre." con los meses de ahora.
  out = out.replace(/(<a:t(?:\s[^>]*)?>)([^<]*remanente de[^<]*)(<\/a:t>)/i, (all, a: string, t: string, b: string) => {
    const nuevo = t
      .replace(/^(\s*Base\s+)\S+?(:)/i, `$1${abrevMes(meses[1]!)}$2`)
      .replace(new RegExp(`(remanente de\\s+)${MES_RE}`, "i"), `$1${nombreMes(meses[1]!).toLowerCase()}`)
      .replace(new RegExp(`(llamad[oa]s?\\s+en\\s+)${MES_RE}`, "i"), `$1${nombreMes(meses[0]!).toLowerCase()}`);
    if (nuevo !== t) cambio(c, block, "Nota", t, nuevo);
    return a + nuevo + b;
  });
  return out;
}

/* ---------- conversión por segmento ---------- */

function graficaSegmentos(c: Ctx, d: PresentacionCampania, chart: string): string {
  const titulo = chartTitle(chart);
  // "Conversión por segmento, bases sep y oct": también el remanente del mes anterior.
  const conRem = /bases\s+\S+\s+y\s+\S+/i.test(titulo);
  if (!d.segmentos?.length) throw new Error("Falta la base del mes de esta campaña (sus columnas dan los segmentos).");
  const segs = extremos(segmentosConversion(d.segmentos, conRem));
  if (!segs.length) throw new Error("La base no trae columnas con segmentos de tamaño suficiente.");
  const e = efectividad([...basesPrincipales(d), ...(conRem ? remanentesPrincipales(d) : [])]);
  const prom = ratio(e.conVenta, e.contactados) * 100;
  const old = readChart(chart)[0];
  const block = "Conversión por segmento";
  for (const s of segs) {
    const i = old?.categories.findIndex((x) => norm(x) === norm(s.label)) ?? -1;
    cambio(c, block, s.label, i >= 0 ? `${old!.values[i]}%` : "—", `${Math.round(s.conv)}% (${s.ventas} de ${s.contactados} contactados)`);
  }
  // Porcentajes enteros en las gráficas (43.6% se presenta como 44%).
  let out = fillChart(chart, [{ categories: segs.map((s) => s.label), values: segs.map((s) => Math.round(s.conv)) }]);
  // Las etiquetas de las barras, sin decimales (como las demás gráficas).
  out = out.replace(/formatCode="0\.0+(&quot;%&quot;|\\?%)"/g, 'formatCode="0$1"');
  out = out.replace(/(prom\.\s*)[\d.,]+(\s*%)/i, (_, a: string, b: string) => `${a}${prom.toFixed(1)}${b}`);
  if (conRem) out = out.replace(/(bases\s+)\S+(\s+y\s+)([^\s(<]+)/i, (_, a: string, y: string) => `${a}${abrevMes(mesAnteriorDe(d.month))}${y}${abrevMes(d.month)}`);
  const nuevo = chartTitle(out);
  if (nuevo !== titulo) cambio(c, block, "Título", titulo, nuevo);
  return out;
}

/* ---------- gap trimestral ---------- */

const TRIMESTRES = ["primer", "segundo", "tercer", "cuarto"];
const trimestreDe = (month: string) => Math.floor((Number(month.slice(5, 7)) - 1) / 3);

function mismoAgente(a: string, b: string): boolean {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (!x.length || !y.length) return false;
  const [small, big] = x.length <= y.length ? [x, y] : [y, x];
  const set = new Set(big);
  return small.length >= 2 ? small.every((t) => set.has(t)) : small.length === big.length && small[0] === big[0];
}

function tablaGapAgentes(c: Ctx, d: PresentacionCampania, slide: string, index: number, cells: string[][]): string {
  const q = trimestreDe(d.month);
  const head = cells[0]!.map(norm);
  const col = head.findIndex((h) => h.startsWith(TRIMESTRES[q]!));
  const totalCol = head.findIndex((h) => h === "total");
  if (col < 0) throw new Error("No encontré la columna del trimestre actual.");
  const meses = d.trimestre.filter((m) => m.metaPorAgente !== null);
  if (!meses.length) throw new Error("Falta la meta y el número de agentes (HC) del mes para calcular el gap por agente.");
  const body = cells.slice(1);
  // Columnas por nombre (EF y Seguros traen además una columna "Status" al inicio).
  const agCol = Math.max(0, head.indexOf("agente"));
  const antCol = head.indexOf("antiguedad");
  const stCol = head.indexOf("status");
  const nombre = (r: string[]) => r[agCol] ?? "";
  // Formato de cada columna de cifras como el de la plantilla ($ con o sin centavos en CDC y Extra).
  const estilo = (j: number) => body.map((r) => r[j] ?? "").find((v) => /\d\.\d/.test(v)) ?? body.map((r) => r[j] ?? "").find((v) => /\d/.test(v)) ?? "0";
  const valor = (v: string) => Number(v.replace(/[,$\s]/g, "")) || 0;
  // Agentes: los que vendieron en el trimestre y los de la plantilla que siguen trabajando (aparecen en el mes aunque no vendieran).
  const gap = new Map<string, number>();
  for (const m of meses) {
    for (const a of m.porAgente) if (!gap.has(a.agent)) gap.set(a.agent, 0);
    for (const a of m.agentes) if (!gap.has(a) && body.some((r) => mismoAgente(nombre(r), a))) gap.set(a, 0);
  }
  for (const m of meses) {
    const ventas = new Map(m.porAgente.map((a) => [a.agent, a.ventas]));
    for (const name of gap.keys()) gap.set(name, gap.get(name)! + (ventas.get(name) ?? 0) - m.metaPorAgente!);
  }
  const block = "Gap por agente";
  const numCol = (j: number) => j !== agCol && j !== antCol && j !== stCol && j !== totalCol;
  const rows = [...gap.entries()].map(([agent, g]) => {
    const tpl = body.find((r) => mismoAgente(nombre(r), agent));
    const vals = head.map((_, j) => {
      if (j === agCol) return (tpl ? nombre(tpl) : agent).toUpperCase();
      if (j === antCol) return tpl?.[j] ?? "< 3";
      if (j === stCol) return tpl?.[j] ?? "Activo";
      if (j === col) return comoAntes(estilo(j), g);
      if (j === totalCol) return "";
      return tpl?.[j] ?? comoAntes(estilo(j), 0);
    });
    const total = vals.reduce((s, v, j) => (numCol(j) ? s + valor(v) : s), 0);
    if (totalCol >= 0) vals[totalCol] = comoAntes(estilo(totalCol), total);
    cambio(c, block, nombre(vals), tpl ? `${tpl[col]} (total ${tpl[totalCol]})` : "nuevo", `${vals[col]} (total ${vals[totalCol]})`);
    return { vals, total };
  });
  for (const r of body) if (![...gap.keys()].some((a) => mismoAgente(nombre(r), a))) cambio(c, block, nombre(r), r[totalCol] ?? "", "ya no aparece en el mes");
  rows.sort((a, b) => b.total - a.total);
  return fillTable(slide, index, { headerRows: 1, rows: rows.map((r) => r.vals) });
}

function tablaGapCampana(c: Ctx, d: PresentacionCampania, slide: string, index: number, cells: string[][]): string {
  const q = trimestreDe(d.month);
  const headerRows = cells.findIndex((r) => norm(r[0] ?? "") === "mes") + 1 || 2;
  const body = cells.slice(headerRows, -1);
  const total = cells[cells.length - 1]!;
  if (norm(total[0] ?? "") !== "total") throw new Error("La tabla no termina en Total.");
  const meses = d.trimestre;
  const meta = sum(meses.map((m) => m.meta ?? 0));
  const real = sum(meses.map((m) => m.resultado));
  if (!meses.some((m) => m.meta !== null)) throw new Error("Falta la meta del mes.");
  const block = "Gap de campaña";
  const num = (s: string | undefined) => Number((s ?? "").replace(/[,$%]/g, "")) || 0;
  const rows = body.map((r) => {
    if (!norm(r[0] ?? "").startsWith(TRIMESTRES[q]!)) return r;
    const out = [r[0] ?? "", comoAntes(r[1] ?? "0", meta), comoAntes(r[2] ?? "0", real), `${Math.round(ratio(real, meta) * 100)}%`, comoAntes(r[4] ?? "0", real - meta)];
    cambio(c, block, r[0] ?? "", r.slice(1).join(" · "), out.slice(1).join(" · "));
    return out;
  });
  const tm = sum(rows.map((r) => num(r[1])));
  const tr = sum(rows.map((r) => num(r[2])));
  const tot = [total[0] ?? "Total", comoAntes(total[1] ?? "0", tm), comoAntes(total[2] ?? "0", tr), `${Math.round(ratio(tr, tm) * 100)}%`, comoAntes(total[4] ?? "0", tr - tm)];
  cambio(c, block, "Total", total.slice(1).join(" · "), tot.slice(1).join(" · "));
  return fillTable(slide, index, { headerRows, rows, total: tot });
}

/* ---------- gráficas ---------- */

function graficaCampana(c: Ctx, d: PresentacionCampania, chart: string, grupo: string | null): string {
  const series = readChart(chart);
  // Gráficas vacías en la plantilla (sin categorías) se dejan como están.
  if (!series.length || !series[0]!.categories.length) return chart;
  const title = norm(chartTitle(chart));
  const cats = series[0]!.categories.map(norm);
  if (title.startsWith("contacto")) return graficaContacto(c, d, chart, series, grupo);
  if (cats.length === 2 && cats[0] === "cumplimiento" && cats[1] === "gap") return graficaCumplimiento(c, d, chart, series);
  if (cats.length && cats.every((x) => /^w\s*\d+$/.test(x))) return graficaSemanas(c, d, chart, series);
  if (title.startsWith("conversion por segmento")) return graficaSegmentos(c, d, chart);
  return chart;
}

const SIN_TIPIFICAR = /^(sin tipificar|sin asignar|en llamada|)$/;

/** Clientes recorridos por la categoría de su última llamada. "Sin asignar a un agente" y "En llamada" van con "Sin Tipificar". */
export function contactoDe(d: PresentacionCampania, grupo: string | null, etiquetas: string[] = []): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of basesDe(d, grupo)) {
    for (const x of b.contacto) {
      const k = norm(x.label);
      const label = SIN_TIPIFICAR.test(k) || k.startsWith("sin asignar") ? (etiquetas.find((t) => norm(t) === "sin tipificar") ?? "Sin Tipificar") : etiqueta(x.label, etiquetas);
      m.set(label, (m.get(label) ?? 0) + x.n);
    }
  }
  return m;
}

/** Cifras de "Cantado vs Activo" de una campaña (o de una de sus bases), con las mismas reglas que la lámina. */
export function resumenGrupo(d: PresentacionCampania, grupo: string | null) {
  const bases = basesDe(d, grupo);
  const vs = ventasDe(d, grupo).filter((v) => v.k !== 2);
  const medida = (xs: PresVenta[]) => sum(xs.map((v) => (d.unidad === "monto" ? v.valor : v.ops)));
  const mes = vs.filter((v) => v.origen === "mes");
  const cosechaActivas = vs.filter((v) => v.origen === "cosecha" && v.k === 1);
  const unicos = sum(bases.map((b) => b.unicos));
  const recorridos = sum(bases.map((b) => b.recorridos));
  return {
    bases: bases.length,
    unicos,
    recorridos,
    nuevo: unicos - recorridos,
    cantadas: medida(mes) + medida(cosechaActivas),
    activas: medida(mes.filter((v) => v.k === 1)) + medida(cosechaActivas),
    activasMes: medida(mes.filter((v) => v.k === 1)),
    cosecha: medida(cosechaActivas),
  };
}

function graficaContacto(c: Ctx, d: PresentacionCampania, chart: string, series: ReturnType<typeof readChart>, grupo: string | null): string {
  const tpl = series[0]!.categories;
  // Si se subió el Excel de las gráficas, el contacto sale de su hoja (la de esa base, o la de toda la campaña).
  const principales = basesPrincipales(d);
  const claves = grupo ? [grupo] : ["*", ...(principales.length === 1 ? [principales[0]!.dataset] : [])];
  const excel = claves.map((k) => d.contactoExcel?.[k]).find(Boolean);
  if (!excel && !basesDe(d, grupo).length) throw new Error("Falta la base del mes.");
  const m = excel ? new Map(excel.map((x) => [etiqueta(x.label, tpl), x.n] as const)) : contactoDe(d, grupo, tpl);
  const items = [...m.entries()].sort((a, b) => b[1] - a[1] || tpl.indexOf(a[0]) - tpl.indexOf(b[0]));
  const block = `Gráfica de contacto${grupo ? ` (${grupo.split(":").pop()})` : ""}${excel ? " · de tu Excel" : ""}`;
  for (const [l, v] of items) {
    const i = tpl.findIndex((t) => norm(t) === norm(l));
    cambio(c, block, l, i >= 0 ? String(series[0]!.values[i] ?? "") : "—", String(v));
  }
  return fillChart(chart, [{ categories: items.map((x) => x[0]), values: items.map((x) => x[1]) }]);
}

function graficaCumplimiento(c: Ctx, d: PresentacionCampania, chart: string, series: ReturnType<typeof readChart>): string {
  if (!d.esperado) throw new Error("Falta la meta del mes (o la sábana) para calcular el cumplimiento MTD.");
  // Porcentaje entero: 43.6% se presenta como 44% (y el GAP, como su complemento: -56%).
  const r = Math.round((d.resultado / d.esperado) * 100) / 100;
  const gap = Math.round((r - 1) * 100) / 100;
  const old = series[0]!.values;
  cambio(c, "Cumplimiento MTD", "Cumplimiento", pctTxt(old[0]), pctTxt(r));
  cambio(c, "Cumplimiento MTD", "GAP", pctTxt(old[1]), pctTxt(gap));
  const out = fillChart(chart, [{ values: [r, gap] }]);
  // La etiqueta toma el formato de los datos: sin decimales.
  return out.replace(/(<c:val>[\s\S]*?<c:formatCode>)0\.0+%(<\/c:formatCode>)/, "$10%$2");
}

const pctTxt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

/** Valores por semana de una medida: las semanas cerradas se respetan (si la plantilla es del mismo mes) y la actual es lo que falta. */
function porSemana(
  d: PresentacionCampania,
  nWeeks: number,
  actual: number,
  total: number,
  bySale: (w: number) => number,
  plantilla: (number | null)[] | null,
): (number | null)[] {
  const out: (number | null)[] = [];
  for (let w = 1; w <= nWeeks; w++) {
    // Semana cerrada: la de la plantilla; si la plantilla no la trae, por fecha de venta.
    if (w < actual) out.push(plantilla && plantilla[w - 1] !== null && plantilla[w - 1] !== undefined ? plantilla[w - 1]! : bySale(w));
    else if (w === actual) out.push(Math.round(Math.max(0, total - sum(out.map((x) => x ?? 0))) * 100) / 100);
    else out.push(null);
  }
  return out;
}

function graficaSemanas(c: Ctx, d: PresentacionCampania, chart: string, series: ReturnType<typeof readChart>): string {
  const weeks = semanasDelMes(d.month);
  const corte = d.fechaCorte && d.fechaCorte.startsWith(d.month) ? d.fechaCorte : null;
  const actual = semanaDe(d.month, corte) ?? 1;
  const tplCats = series[0]!.categories;
  // Si el mes tiene más semanas que la gráfica y ya se llegó a ellas, se agregan con el mismo estilo de nombre.
  const n = Math.max(tplCats.length, Math.min(weeks.length, actual));
  const style = tplCats[tplCats.length - 1] ?? "W 1";
  const cats = Array.from({ length: n }, (_, i) => tplCats[i] ?? style.replace(/\d+/, String(i + 1)));
  const same = c.opts.mesPlantilla === d.month;
  const act = d.ventas.filter((v) => v.k === 1);
  const delMes = act.filter((v) => v.origen === "mes");
  const block = "Ventas por semana";
  const medida = (vs: PresVenta[], clientes: boolean) => sum(vs.map((v) => (clientes ? v.clientes : d.unidad === "monto" ? v.valor : v.ops)));
  // Clientes distintos (no se pueden sumar por grupos): los da el servidor, en total y por semana.
  const cli = d.clientesActivos;
  const calc = (filter: (v: PresVenta) => boolean, clientes: boolean, tplVals: (number | null)[]) =>
    porSemana(
      d,
      n,
      actual,
      clientes && cli ? cli.total : medida(act.filter(filter), clientes),
      (w) => (clientes && cli ? (cli.porSemana[String(w)] ?? 0) : medida(delMes.filter((v) => filter(v) && v.semana === w), clientes)),
      same ? tplVals : null,
    );

  const fills: { name?: string; categories: string[]; values: (number | null)[] }[] = [];
  let clientes: (number | null)[] | null = null;
  let colectores: (number | null)[] | null = null;
  const pending: number[] = [];
  series.forEach((s, i) => {
    const k = norm(s.name);
    let values: (number | null)[] | null = null;
    if (k === "meta") values = cats.map(() => (d.meta === null ? null : d.unidad === "monto" ? d.meta / 5 : Math.round(d.meta / 5)));
    else if (k === "promedio") pending.push(i);
    else if (k === "clientes") values = clientes = calc(() => true, true, s.values);
    else if (k === "colectores") values = colectores = calc(() => true, false, s.values);
    else if (k === "activas" || k === "ventas" || k === "resultado" || /activas/.test(k)) values = calc(() => true, false, s.values);
    else {
      const procs = [...new Set(d.ventas.map((v) => v.proceso))];
      const p = procs.find((x) => norm(x).startsWith(k) || k.startsWith(norm(x)));
      if (p) values = calc((v) => v.proceso === p, false, s.values);
    }
    fills[i] = { categories: cats, values: values ?? cats.map((_, j) => s.values[j] ?? null) };
    if (values) cats.forEach((cat, j) => cambio(c, block, `${s.name.trim()} ${cat}`, s.values[j] === null || s.values[j] === undefined ? "—" : String(s.values[j]), values![j] === null ? "—" : String(values![j])));
  });
  for (const i of pending) {
    const s = series[i]!;
    const values = cats.map((_, j) => (clientes?.[j] && colectores?.[j] !== null && colectores?.[j] !== undefined ? colectores[j]! / clientes[j]! : null));
    fills[i] = { categories: cats, values };
    cats.forEach((cat, j) => cambio(c, block, `${s.name.trim()} ${cat}`, s.values[j] ? s.values[j]!.toFixed(2) : "—", values[j] === null ? "—" : values[j]!.toFixed(2)));
  }
  return fillChart(chart, fills);
}

/** Guarda una gráfica ya llenada y la desliga del Excel externo: si al abrir la presentación alguien da
    "Actualizar vínculos", PowerPoint traería los números de ese Excel (de otra fecha) encima de los de la app. */
async function escribirGrafica(deck: PresDeck, part: string, xml: string): Promise<void> {
  const rid = /<c:externalData\b[^>]*\br:id="([^"]+)"/.exec(xml)?.[1];
  deck.write(part, xml.replace(/<c:externalData\b[^>]*\/>|<c:externalData\b[\s\S]*?<\/c:externalData>/g, ""));
  if (!rid) return;
  const i = part.lastIndexOf("/");
  const relsPart = `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
  if (!deck.has(relsPart)) return;
  const rels = await deck.read(relsPart);
  deck.write(relsPart, rels.replace(new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*/>`), ""));
}

/* ---------- recuadros M (meta) y R (resultado) ---------- */

async function smartArt(c: Ctx, d: PresentacionCampania, dataPart: string, slideRels: Awaited<ReturnType<PresDeck["rels"]>>): Promise<void> {
  const data = await c.deck.read(dataPart);
  const t = texts(data).map((x) => x.trim()).filter(Boolean);
  if (t.length !== 2 || !/^[MR]$/.test(t[0]!)) return;
  const old = t[1]!;
  // M es la meta MTD (a los días hábiles que lleva la sábana), igual que en el Excel: (meta ÷ días del mes) × días transcurridos.
  const value = t[0] === "M" ? d.esperado : d.resultado;
  if (value === null) throw new Error("Falta la meta del mes (o la sábana) para calcular la meta MTD.");
  const now = comoAntes(old, value, d.unidad === "monto" ? { comas: true } : {});
  cambio(c, t[0] === "M" ? `Recuadro M (meta MTD, ${d.diasHabiles.transcurridos} de ${d.diasHabiles.total} días hábiles)` : "Recuadro R (resultado)", t[0]!, old, now);
  if (now === old) return;
  c.deck.write(dataPart, replaceExactText(data, old, now).xml);
  // El dibujo ya armado del SmartArt (lo que se ve) también trae el número.
  const relId = /<dsp:dataModelExt\b[^>]*relId="([^"]+)"/.exec(data)?.[1];
  const drawing = relId ? slideRels.find((r) => r.id === relId)?.target : undefined;
  if (drawing && c.deck.has(drawing)) c.deck.write(drawing, replaceExactText(await c.deck.read(drawing), old, now).xml);
}

