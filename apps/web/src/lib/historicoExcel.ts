/* Excel del histórico: los meses elegidos, con el cumplimiento, el contacto de la base y la conversión de cada mes
   (MES A MES) y sus tipificaciones (TIPOLOGÍAS, un mes por columna para compararlos lado a lado). */
import { DIAS_SEMANA, libroConEstilos, recomendaciones, type ColumnaEstilo, type MonthSummary, type PerfilMes, type ValorCelda } from "@crm/core";
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
  /** Composición de la base y efectividad de la llamada de los meses (los que tienen base). */
  perfil: PerfilMes[];
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

const perfilesOrdenados = (x: ExcelHistorico) => [...x.perfil].sort((a, b) => a.month.localeCompare(b.month));

/** Cada segmentación de la base: clientes, % de la base, contacto y conversión, un mes al lado del otro. */
function hojaComposicion(x: ExcelHistorico) {
  const meses = perfilesOrdenados(x);
  const ultimo = meses[meses.length - 1]!;
  const dims = meses.flatMap((m) => m.dimensiones.map((d) => ({ key: d.key, label: d.label }))).filter((d, i, a) => a.findIndex((y) => y.key === d.key) === i);
  const filas: ValorCelda[][] = [];
  for (const d of dims) {
    const de = (m: PerfilMes, v: string) => m.dimensiones.find((y) => y.key === d.key)?.valores.find((y) => y.valor === v);
    const valores = [...new Set(meses.flatMap((m) => m.dimensiones.find((y) => y.key === d.key)?.valores.map((v) => v.valor) ?? []))].sort(
      (a, b) => (de(ultimo, b)?.clientes ?? 0) - (de(ultimo, a)?.clientes ?? 0),
    );
    for (const v of valores)
      filas.push([
        d.label,
        v,
        ...meses.flatMap((m) => {
          const r = de(m, v);
          if (!r) return [null, null, null, null];
          return [r.clientes, div(r.clientes, m.base), m.conLlamadas ? div(r.contactados, r.clientes) : null, m.conLlamadas ? div(r.ventas, r.contactados) : null];
        }),
      ]);
  }
  return {
    nombre: "COMPOSICIÓN DE BASE",
    fuente: { nombre: "Calibri", tamano: 11 },
    congelar: { columnas: 2 },
    columnas: [
      col("SEGMENTACIÓN", 24),
      col("VALOR", 34),
      ...meses.flatMap((m) => [col(`${corto(m.month)} CLIENTES`, 14, ENT), col(`${corto(m.month)} % BASE`, 12, PCT), col(`${corto(m.month)} CONTACTO`, 14, PCT), col(`${corto(m.month)} CONVERSIÓN`, 16, PCT)]),
    ],
    filas,
  };
}

/** Por hora de la llamada y por día de la semana: llamadas, contactabilidad, ventas y conversión de cada mes. */
function hojaHorasDias(x: ExcelHistorico) {
  const meses = perfilesOrdenados(x).filter((m) => m.conLlamadas);
  const horas = [...new Set(meses.flatMap((m) => m.horas.map((h) => h.hora)))].sort((a, b) => a - b);
  const dias = [1, 2, 3, 4, 5, 6, 0].filter((d) => meses.some((m) => m.dias.some((y) => y.dia === d)));
  const celdas = (r: { llamadas: number; efectivos: number; ventas: number } | undefined) => (r ? [r.llamadas, div(r.efectivos, r.llamadas), r.ventas, div(r.ventas, r.efectivos)] : [null, null, null, null]);
  const filas: ValorCelda[][] = [
    ...horas.map((h) => ["HORA", `${String(h).padStart(2, "0")}:00`, ...meses.flatMap((m) => celdas(m.horas.find((y) => y.hora === h)))]),
    ...dias.map((d) => ["DÍA", DIAS_SEMANA[d]!.toUpperCase(), ...meses.flatMap((m) => celdas(m.dias.find((y) => y.dia === d)))]),
  ];
  return {
    nombre: "HORAS Y DÍAS",
    fuente: { nombre: "Calibri", tamano: 11 },
    congelar: { columnas: 2 },
    columnas: [
      col("POR", 8),
      col("HORA / DÍA", 14),
      ...meses.flatMap((m) => [col(`${corto(m.month)} LLAMADAS`, 14, ENT), col(`${corto(m.month)} CONTACTABILIDAD`, 18, PCT), col(`${corto(m.month)} VENTAS`, 12, ENT), col(`${corto(m.month)} CONVERSIÓN`, 16, PCT)]),
    ],
    filas,
  };
}

/** Perfil × franja horaria donde la conversión de la llamada supera el promedio del mes (al menos 20 contactos efectivos). */
function hojaDondeConvierto(x: ExcelHistorico) {
  const filas: ValorCelda[][] = perfilesOrdenados(x)
    .filter((m) => m.conLlamadas)
    .flatMap((m) =>
      recomendaciones(m, 20, 10).map((r) => [monthLabel(m.month).toUpperCase(), r.dimension, r.valor, r.franja, r.efectivos, r.ventas, r.conversion, r.promedio, r.veces]),
    );
  return {
    nombre: "DÓNDE CONVIERTO",
    fuente: { nombre: "Calibri", tamano: 11 },
    congelar: { columnas: 1 },
    columnas: [
      col("MES", 16),
      col("SEGMENTACIÓN", 24),
      col("VALOR", 32),
      col("FRANJA", 18),
      col("CONTACTOS EFECTIVOS", 15, ENT),
      col("VENTAS", 10, ENT),
      col("CONVERSIÓN", 13, PCT),
      col("PROMEDIO DEL MES", 14, PCT),
      col("VECES EL PROMEDIO", 14, DEC),
    ],
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
  const libro = libroConEstilos([hojaMesAMes(x), hojaMtd(x), ...(x.perfil.length ? [hojaComposicion(x), hojaHorasDias(x), hojaDondeConvierto(x)] : []), hojaTipologias(x)]);
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
