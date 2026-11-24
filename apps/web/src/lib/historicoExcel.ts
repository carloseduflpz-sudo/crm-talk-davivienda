/* Excel del histórico: los meses elegidos, con el cumplimiento, el contacto de la base y la conversión de cada mes
   (MES A MES) y sus tipificaciones (TIPOLOGÍAS, un mes por columna para compararlos lado a lado). */
import { libroConEstilos, type ColumnaEstilo, type MonthSummary, type ValorCelda } from "@crm/core";
import type { ContactoBaseMes, MtdMes, TipologiaMes } from "./api";
import { monthLabel } from "./xlsx";

const AZUL = "1F3864";
const BLANCO = "FFFFFF";
const ENT = "#,##0";
const DIN = "$#,##0.00";
const PCT = "0.0%";
const PCT2 = "0.00%";
const PP = "+0.0%;-0.0%;0.0%";
const DEC = "0.0";

const col = (titulo: string, ancho: number, formato?: string, alinear: ColumnaEstilo["alinear"] = formato ? "right" : "left"): ColumnaEstilo => ({
  titulo,
  ancho,
  relleno: AZUL,
  letra: BLANCO,
  negrita: true,
  alinear,
  ...(formato ? { formato, tipo: "numero" as const } : {}),
});
/** "noviembre 2026" → "NOV 2026" */
const corto = (m: string) => `${monthLabel(m).slice(0, 3).toUpperCase()} ${m.slice(0, 4)}`;
const pct = (v: number | null) => (v === null ? null : v / 100);
const div = (a: number, b: number) => (b ? a / b : null);

export interface ExcelHistorico {
  campana: string;
  /** Meses elegidos, en orden. */
  meses: MonthSummary[];
  tipologias: TipologiaMes[];
  contacto: ContactoBaseMes[];
  /** Cada mes al mismo día del mes en curso (hoja MTD), con su proyección al cierre. */
  mtd: MtdMes[];
  /** Día de corte del MTD. */
  dia: number;
  /** Meses que tienen tipificaciones cargadas (en los demás las celdas quedan vacías, no en cero). */
  conTipificaciones: string[];
  /** La meta va en dólares (CDC, Extra). */
  money: boolean;
  agente: string | null;
}

function hojaMesAMes(x: ExcelHistorico) {
  const { meses, money } = x;
  type Col = [ColumnaEstilo, (r: MonthSummary, i: number) => ValorCelda];
  const c = (k: ColumnaEstilo, v: (r: MonthSummary, i: number) => ValorCelda): Col => [k, v];
  const unidad = money ? DIN : ENT;
  const cb = new Map(x.contacto.map((k) => [k.month, k]));
  const de = (r: MonthSummary) => cb.get(r.month);
  const columnas: Col[] = [
    c(col("MES", 16), (r) => monthLabel(r.month).toUpperCase()),
    // Cumplimiento
    c(col("META", 13, unidad), (r) => r.meta),
    c(col("LOGRADO", 13, unidad), (r) => r.logrado),
    ...(meses.some((m) => m.oficial && m.logradoSabana != null) ? [c(col("SEGÚN LA SÁBANA", 16, unidad), (r) => (r.oficial ? (r.logradoSabana ?? null) : null))] : []),
    c(col("CUMPLIMIENTO", 14, PCT), (r) => pct(r.cumplimiento)),
    c(col("VAR. CUMPLIMIENTO VS MES ANTERIOR", 20, PP), (r, i) => {
      const antes = i > 0 ? meses[i - 1]!.cumplimiento : null;
      return r.cumplimiento === null || antes === null ? null : (r.cumplimiento - antes) / 100;
    }),
    c(col("DÍAS HÁBILES", 12, ENT), (r) => r.diasHabiles),
    // Contacto de la base
    c(col("BASE", 11, ENT), (r) => de(r)?.base ?? r.base),
    c(col("CLIENTES LLAMADOS", 15, ENT), (r) => de(r)?.llamados ?? null),
    c(col("BARRIDO DE BASE", 14, PCT), (r) => (de(r)?.base ? div(de(r)!.llamados, de(r)!.base!) : null)),
    c(col("CLIENTES CONTACTADOS", 16, ENT), (r) => de(r)?.contactados ?? null),
    c(col("CONTACTO DE BASE", 14, PCT), (r) => (de(r)?.base ? div(de(r)!.contactados, de(r)!.base!) : null)),
    c(col("LLAMADAS", 11, ENT), (r) => r.llamadas),
    c(col("INTENTOS POR CLIENTE", 15, DEC), (r) => (r.llamadas !== null && r.registros ? div(r.llamadas, r.registros) : null)),
    c(col("CONTACTABILIDAD", 15, PCT), (r) => pct(r.contactabilidad)),
    // Conversión: clientes con venta en VICI sobre los contactados.
    c(col("VENTAS VICI", 12, ENT), (r) => de(r)?.ventas ?? null),
    c(col("CONVERSIÓN", 13, PCT), (r) => (de(r)?.contactados ? div(de(r)!.ventas, de(r)!.contactados) : null)),
    c(col("PENETRACIÓN", 13, PCT2), (r) => pct(r.penetracion)),
    c({ ...col("DATOS HASTA", 13, undefined, "center"), tipo: "fecha" }, (r) => r.hasta),
  ];
  return {
    nombre: "MES A MES",
    fuente: { nombre: "Calibri", tamano: 11 },
    congelar: { columnas: 1 },
    columnas: columnas.map(([k]) => k),
    filas: meses.map((m, i) => columnas.map(([, v]) => v(m, i))),
  };
}

/**
 * Cada mes al mismo día (el corte del mes en curso): meta y logrado MTD, ritmo, proyección al cierre y necesidad
 * diaria; y al lado, el mes completo. En los meses cerrados la proyección se compara con lo que de verdad cerró.
 */
function hojaMtd(x: ExcelHistorico) {
  const unidad = x.money ? DIN : ENT;
  const diaria = x.money ? DIN : DEC;
  const porMes = new Map(x.mtd.map((m) => [m.month, m]));
  const columnas = [
    col("MES", 16),
    { ...col("CORTE", 12, undefined, "center"), tipo: "fecha" as const },
    col("DÍAS HÁBILES AL CORTE", 14, ENT),
    col("DÍAS HÁBILES DEL MES", 14, ENT),
    col("META DEL MES", 13, unidad),
    col("META MTD", 13, unidad),
    col("LOGRADO MTD", 13, unidad),
    col("CUMPLIMIENTO MTD", 15, PCT),
    col("GAP VS META MTD", 13, unidad),
    col("RITMO DIARIO", 12, diaria),
    col("PROYECCIÓN AL CIERRE", 15, unidad),
    col("CUMPLIMIENTO PROYECTADO", 16, PCT),
    col("NECESIDAD DIARIA PARA LA META", 18, diaria),
    col("LOGRADO MES COMPLETO", 15, unidad),
    col("CUMPLIMIENTO MES COMPLETO", 16, PCT),
  ];
  const filas: ValorCelda[][] = x.meses.map((r) => {
    const m = porMes.get(r.month);
    const meta = r.meta ?? m?.meta ?? null;
    const logrado = m?.logrado ?? null;
    const al = m?.diasAlCorte ?? 0;
    const total = m?.diasHabiles ?? r.diasHabiles;
    const metaMtd = meta !== null && total ? (meta * al) / total : null;
    const ritmo = logrado !== null && al ? logrado / al : null;
    const proy = ritmo !== null ? ritmo * total : null;
    const restantes = total - al;
    return [
      monthLabel(r.month).toUpperCase(),
      m ? `${r.month}-${String(m.dia).padStart(2, "0")}` : null,
      m ? al : null,
      total || null,
      meta,
      metaMtd,
      logrado,
      logrado !== null && metaMtd ? logrado / metaMtd : null,
      logrado !== null && metaMtd !== null ? logrado - metaMtd : null,
      ritmo,
      proy,
      proy !== null && meta ? proy / meta : null,
      meta !== null && logrado !== null && restantes > 0 ? Math.max(0, meta - logrado) / restantes : null,
      r.logrado,
      pct(r.cumplimiento),
    ];
  });
  return {
    nombre: `MTD AL DÍA ${x.dia}`,
    fuente: { nombre: "Calibri", tamano: 11 },
    congelar: { columnas: 1 },
    columnas,
    filas,
  };
}

/** Una fila por categoría y tipificación y, por mes, sus llamadas y su % del total de llamadas del mes. */
function hojaTipologias(x: ExcelHistorico) {
  const meses = x.meses.map((m) => m.month);
  const grupos = new Map<string, { categoria: string; tipologia: string; porMes: Map<string, number>; total: number }>();
  const totalMes = new Map<string, number>();
  for (const t of x.tipologias) {
    const k = `${t.categoria}\u0000${t.tipologia}`;
    const g = grupos.get(k) ?? { categoria: t.categoria, tipologia: t.tipologia, porMes: new Map(), total: 0 };
    g.porMes.set(t.month, (g.porMes.get(t.month) ?? 0) + t.llamadas);
    g.total += t.llamadas;
    grupos.set(k, g);
    totalMes.set(t.month, (totalMes.get(t.month) ?? 0) + t.llamadas);
  }
  // Por categoría (la de más llamadas primero) y dentro, de mayor a menor.
  const porCategoria = new Map<string, number>();
  for (const g of grupos.values()) porCategoria.set(g.categoria, (porCategoria.get(g.categoria) ?? 0) + g.total);
  const orden = [...grupos.values()].sort(
    (a, b) => porCategoria.get(b.categoria)! - porCategoria.get(a.categoria)! || a.categoria.localeCompare(b.categoria) || b.total - a.total,
  );
  const base = [col("CATEGORÍA", 30), col("TIPIFICACIÓN", 34)];
  const columnas = [...base, ...meses.flatMap((m) => [col(`${corto(m)} LLAMADAS`, 15, ENT), col(`${corto(m)} %`, 11, PCT)])];
  const conTip = new Set(x.conTipificaciones);
  const filas: ValorCelda[][] = orden.map((g) => [
    g.categoria,
    g.tipologia,
    ...meses.flatMap((m) => {
      if (!conTip.has(m)) return [null, null];
      const n = g.porMes.get(m) ?? 0;
      return [n, div(n, totalMes.get(m) ?? 0)];
    }),
  ]);
  filas.push(["TOTAL", "", ...meses.flatMap((m) => (conTip.has(m) ? [totalMes.get(m) ?? 0, totalMes.get(m) ? 1 : null] : [null, null]))]);
  return {
    nombre: "TIPOLOGÍAS",
    fuente: { nombre: "Calibri", tamano: 11 },
    congelar: { columnas: base.length },
    negrita: [filas.length - 1],
    columnas,
    filas,
  };
}

export function descargarHistorico(x: ExcelHistorico): void {
  const libro = libroConEstilos([hojaMesAMes(x), hojaMtd(x), hojaTipologias(x)]);
  const url = URL.createObjectURL(new Blob([libro as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  const primero = x.meses[0]!.month;
  const ultimo = x.meses[x.meses.length - 1]!.month;
  a.href = url;
  a.download = `HISTORICO ${x.campana.toUpperCase()}${x.agente ? ` ${x.agente.toUpperCase()}` : ""} ${corto(primero)}${ultimo !== primero ? ` A ${corto(ultimo)}` : ""}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
