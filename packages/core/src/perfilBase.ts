/* Composición de la base y efectividad comercial (llamada, no sábana): con qué segmentaciones viene cada base y
   en qué perfil de cliente, a qué hora y qué día se contacta y se vende más. */

/** Una segmentación de la base: un campo del archivo de la base (o perfil/oferta) y, si es número, sus rangos. */
export interface DimensionBase {
  key: string;
  label: string;
  /** "profile" u "offer" (columnas de base_records) o el nombre del campo guardado en extra. */
  campo: string;
  /** Límites de los rangos (números): [25, 35] → "Hasta 25", "26 a 35", "Más de 35". */
  rangos?: number[];
  dinero?: boolean;
}

const EDAD: Omit<DimensionBase, "campo"> = { key: "edad", label: "Edad", rangos: [25, 35, 45, 55] };
const d = (key: string, label: string, campo: string, extra: Partial<DimensionBase> = {}): DimensionBase => ({ key, label, campo, ...extra });

/** Segmentaciones de cada base. La misma `key` en dos bases de la campaña se junta (p. ej. Perfil en Primeras y Segundas). */
export const DIMENSIONES_BASE: Record<string, DimensionBase[]> = {
  "tdc:base:primeras": [
    d("perfil", "Perfil", "profile"), d("segmento", "Segmento", "Segmento"), d("cluster", "Cluster TC", "Cluster"), d("riesgo", "Clasificación de riesgo", "ClasifRiesgo"),
    d("oferta", "Oferta / tarjeta", "offer"), d("producto", "Producto principal", "Producto Principal"), { ...EDAD, campo: "Edad" }, d("genero", "Género", "Genero"),
    d("limite", "Límite", "Limite", { rangos: [500, 1000, 2000, 4000], dinero: true }),
  ],
  "tdc:base:segundas": [
    d("perfil", "Perfil", "profile"), d("segmento", "Segmento", "TipoEmpresa"), d("oferta", "Oferta / tarjeta", "offer"), d("condicion", "Condición", "CI"),
    d("asignacion", "Asignación", "ASIGNACION"), { ...EDAD, campo: "Edad" }, d("salario", "Salario", "Salario", { rangos: [500, 1000, 2000], dinero: true }),
    d("limite", "Límite", "Limite", { rangos: [500, 1000, 2000, 4000], dinero: true }),
  ],
  "extrafin:base": [
    d("perfil", "Perfil", "profile"), d("segmento", "Segmento", "Segmento"), d("oferta", "Tarjeta", "offer"), d("riesgo", "Clasificación de riesgo", "ClasifRiesgo"),
    { ...EDAD, campo: "Edad" }, d("monto", "Monto ofertado", "Monto", { rangos: [500, 1000, 2000, 5000], dinero: true }),
  ],
  "cdc:base:cdc": [
    d("perfil", "Perfil", "profile"), d("segmento", "Segmento empresa", "Segmento Empresa"), d("producto", "Tipo de producto", "Tipo de Producto"),
    d("tipoOferta", "Tipo de oferta", "Tipo de Oferta"), d("competencia", "TC competencia", "TC Competencia"), d("oferta", "Tipo CDC", "offer"),
    d("premium", "Premium", "Premium"), d("probabilidad", "Probabilidad de venta CDC", "Probabilidad de venta CDC"), { ...EDAD, campo: "Edad" }, d("genero", "Género", "Genero"),
    d("traslado", "Límite CDC a trasladar", "Límite CDC a trasladar", { rangos: [500, 1000, 2000, 5000], dinero: true }),
  ],
  "cdc:base:bienvenida": [
    d("perfil", "Perfil", "profile"), d("segmento", "Segmento empresa", "Segmento Empresa"), d("segmentoCliente", "Segmento cliente", "Segmento Cliente"),
    d("oferta", "Producto", "offer"), d("origen", "Origen de base", "Origen de Base"), d("portafolio", "Portafolio", "Portafolio"), d("premium", "Premium", "Premium"),
    { ...EDAD, campo: "Edad" }, d("salario", "Salario", "Salario", { rangos: [500, 1000, 2000], dinero: true }),
  ],
  "upin:base": [
    d("perfil", "Perfil", "profile"), d("oferta", "Tipo de iniciativa", "offer"), d("riesgo", "Clasificación de riesgo", "Clasificación Riesgo"), d("cluster", "Cluster TC", "Cluster_TC"),
    d("premium", "Premium", "Premium"), d("tarjeta", "Tipo de tarjeta", "Tipo Tarjeta"), d("limite", "Límite actual", "Límite Actual", { rangos: [500, 1000, 2000, 4000], dinero: true }),
  ],
  "seguros:base": [
    d("perfil", "Perfil", "profile"), d("segmento", "Segmento empresa", "Segmento Empresa"), d("ingresos", "Rango de ingresos", "Rango Ingresos"), d("cluster", "Cluster TC", "Cluster TC"),
    d("tarjeta", "Tipo de TC", "Tipo de TC"), d("oferta", "Oferta Todo Protegido", "offer"), { ...EDAD, campo: "Edad" }, d("genero", "Género", "Genero"),
  ],
  "domi:base:domi": [
    d("perfil", "Perfil", "profile"), d("segmento", "Segmento empresa", "Segmento Empresa"), d("oferta", "Colectores que paga", "offer"), d("domiActiva", "Domi activa", "Domi Activa"),
    d("probabilidad", "Mayor prob. de aceptación", "Mayor Prob. Aceptación"), { ...EDAD, campo: "Edad" },
  ],
  "domi:base:piloto": [d("oferta", "Estado", "offer")],
  "seguros:base:renorepo": [
    d("estado", "Estado del seguro", "profile"), d("plan", "Plan", "offer"), d("tarjeta", "Tarjeta", "Tarjeta"), d("medioPago", "Medio de pago", "MedioPago"),
  ],
};

/** Sin dato en el archivo de la base. */
export const SIN_DATO = "(sin dato)";

const fmtRango = (n: number, dinero?: boolean) => (dinero ? `$${n.toLocaleString("en-US")}` : String(n));

/** Valor de un cliente en una segmentación: el texto tal cual (sin espacios de más) o su rango si es número. */
export function valorDimension(dim: DimensionBase, v: unknown): string {
  if (v === null || v === undefined || String(v).trim() === "" || String(v).trim() === "-") return SIN_DATO;
  if (!dim.rangos) return String(v).trim().replace(/\s+/g, " ");
  const n = Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return SIN_DATO;
  const r = dim.rangos;
  if (n <= r[0]!) return `Hasta ${fmtRango(r[0]!, dim.dinero)}`;
  for (let i = 1; i < r.length; i++) if (n <= r[i]!) return `${fmtRango(r[i - 1]! + 1, dim.dinero)} a ${fmtRango(r[i]!, dim.dinero)}`;
  return `Más de ${fmtRango(r[r.length - 1]!, dim.dinero)}`;
}

/** Orden de los valores de una segmentación: los rangos de menor a mayor; lo demás, como venga. */
export function ordenRango(dim: DimensionBase, valor: string): number {
  if (!dim.rangos || valor === SIN_DATO) return valor === SIN_DATO ? 999 : 0;
  if (valor.startsWith("Hasta")) return 0;
  if (valor.startsWith("Más de")) return 998;
  const n = Number(valor.replace(/[$,]/g, "").split(" ")[0]);
  return Number.isFinite(n) ? n : 500;
}

/** Franjas de 2 horas para cruzar perfil × hora. */
export const FRANJAS = [
  { desde: 7, hasta: 9, label: "7:00 a 8:59" },
  { desde: 9, hasta: 11, label: "9:00 a 10:59" },
  { desde: 11, hasta: 13, label: "11:00 a 12:59" },
  { desde: 13, hasta: 15, label: "13:00 a 14:59" },
  { desde: 15, hasta: 17, label: "15:00 a 16:59" },
  { desde: 17, hasta: 19, label: "17:00 a 18:59" },
  { desde: 19, hasta: 24, label: "19:00 en adelante" },
];
export const franjaDe = (hora: number): string => (FRANJAS.find((f) => hora >= f.desde && hora < f.hasta) ?? { label: "Antes de 7:00" }).label;

export const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Lo que devuelve el servidor por mes. Llamada a llamada (por hora y día) y cliente a cliente (por segmentación). */
export interface PerfilMes {
  month: string;
  /** Clientes distintos de las bases vigentes del mes. */
  base: number;
  /** Sin tipificaciones del mes: no hay contacto ni conversión. */
  conLlamadas: boolean;
  /** Por segmentación: clientes de la base, llamados, con contacto efectivo y con venta (tipificada en VICI). */
  dimensiones: { key: string; label: string; valores: { valor: string; clientes: number; llamados: number; contactados: number; ventas: number }[] }[];
  /** Por hora de la llamada (todas las llamadas del mes): llamadas, contactos efectivos y ventas. */
  horas: { hora: number; llamadas: number; efectivos: number; ventas: number }[];
  /** Por día de la semana (0 = domingo). */
  dias: { dia: number; llamadas: number; efectivos: number; ventas: number }[];
  /** Perfil × franja horaria (llamadas a clientes de la base): contactos efectivos y ventas. */
  cruces: { key: string; valor: string; franja: string; llamadas: number; efectivos: number; ventas: number }[];
}

/** Llamadas a clientes de la base del mes: contactos efectivos, ventas y conversión (todas las franjas de una segmentación las suman todas). */
export function promedioBase(m: PerfilMes): { efectivos: number; ventas: number; promedio: number } {
  const una = m.cruces.filter((c) => c.key === m.cruces[0]?.key);
  const efectivos = una.reduce((a, c) => a + c.efectivos, 0);
  const ventas = una.reduce((a, c) => a + c.ventas, 0);
  return { efectivos, ventas, promedio: efectivos ? ventas / efectivos : 0 };
}

export interface Recomendacion {
  dimension: string;
  valor: string;
  franja: string;
  efectivos: number;
  ventas: number;
  conversion: number;
  promedio: number;
  veces: number;
}

/**
 * Dónde se convierte más: perfil × franja con al menos `minimo` contactos efectivos, ordenado por cuántas veces
 * supera la conversión promedio de la llamada (ventas ÷ contactos efectivos).
 */
export function recomendaciones(m: PerfilMes, minimo = 20, cuantas = 6): Recomendacion[] {
  const { promedio } = promedioBase(m);
  if (!promedio) return [];
  const labels = new Map(m.dimensiones.map((x) => [x.key, x.label]));
  return m.cruces
    .filter((c) => c.efectivos >= minimo && c.ventas >= 3 && c.valor !== SIN_DATO)
    .map((c) => ({
      dimension: labels.get(c.key) ?? c.key,
      valor: c.valor,
      franja: c.franja,
      efectivos: c.efectivos,
      ventas: c.ventas,
      conversion: c.ventas / c.efectivos,
      promedio,
      veces: c.ventas / c.efectivos / promedio,
    }))
    .filter((r) => r.veces >= 1.2)
    .sort((a, b) => b.veces - a.veces || b.ventas - a.ventas)
    // Un perfil una vez (con su mejor franja).
    .filter((r, i, arr) => arr.findIndex((x) => x.dimension === r.dimension && x.valor === r.valor) === i)
    .slice(0, cuantas);
}
