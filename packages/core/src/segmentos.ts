/* Conversión por segmento: qué tipo de cliente de la base compra más y cuál menos.
   Cada columna de la base (perfil, tipo de tarjeta, segmento, tasa, monto, límite, disponible…) parte a los
   clientes en segmentos; la conversión de cada segmento es clientes con venta ÷ clientes contactados, igual que la
   "Conversión sobre contacto" de la tabla de efectividad. La gráfica muestra los 5 segmentos que menos convierten
   y los 5 que más. */
import type { CampaignCode } from "./campaigns";

/** Clientes de la base por valor de una columna (lo agrupa el servidor). */
export interface PresSegmentoFila {
  /** Columna de la base ("Perfil", "Tasa", "Segmento"…). */
  columna: string;
  valor: string | number;
  /** 1 = remanente del mes anterior (cliente que no viene en la base de este mes). */
  rem: 0 | 1;
  clientes: number;
  contactados: number;
  ventas: number;
}

export interface Segmento {
  label: string;
  columna: string;
  clientes: number;
  contactados: number;
  ventas: number;
  /** Conversión sobre contacto, en %. */
  conv: number;
}

/** Bases que cuentan como "la base" de la campaña (DOMI y CDC: la Bau; la piloto y la de bienvenida van aparte). */
export function datasetsPrincipales(campaign: CampaignCode | string, datasets: string[]): string[] {
  const principal = ({ domi: "domi:base:domi", cdc: "cdc:base:cdc" } as Record<string, string>)[campaign];
  return principal && datasets.includes(principal) ? [principal] : datasets;
}

const quitarAcentos = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Columnas que identifican a la persona o no describen al cliente: no son segmentos. */
const NO_SEGMENTO = [
  /^(niu|dui|nit|id|no\.?|n°|#)$/,
  /niu|dui|nombre|correo|e-?mail|telefono|tel\.|^tel|celular|movil|whats|direccion|domicilio|fecha|hora|f\.\s|municipio|departamento|distrito|ciudad|^cliente$|cargo|observ|comentario|^numero|placa|referencia/,
];
export const esColumnaDeSegmento = (columna: string) => !NO_SEGMENTO.some((r) => r.test(quitarAcentos(columna)));

/** "AplicaCDC" → "Aplica CDC", "ClasifRiesgo" → "Clasif Riesgo". */
const legible = (columna: string) => columna.trim().replace(/([a-záéíóúñ])([A-ZÁÉÍÓÚÑ])/g, "$1 $2");

/** Nombre corto de la columna para la etiqueta. */
function corto(columna: string): string {
  const k = quitarAcentos(columna);
  if (k.startsWith("disponible")) return "Disp.";
  if (k.startsWith("limite")) return "Límite";
  if (k.startsWith("salario")) return "Salario";
  if (k.startsWith("monto")) return "Monto";
  if (k.startsWith("tasa")) return "Tasa";
  return legible(columna);
}

const esDinero = (columna: string) => /monto|limite|disponible|salario|ingreso|saldo|cuota|pago|deuda|incremento|credito|prestamo/.test(quitarAcentos(columna));
const esTasa = (columna: string) => /tasa|porcentaje|%/.test(quitarAcentos(columna));

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s/(-])([a-záéíóúñü])/g, (_, a: string, b: string) => a + b.toUpperCase());

function dinero(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) {
    const k = a / 1000;
    return `$${Number.isInteger(k) ? k : k.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `$${Math.round(a)}`;
}

function numeroTxt(columna: string, v: number, escala: number): string {
  if (esDinero(columna)) return dinero(v);
  if (esTasa(columna)) {
    const p = v * escala;
    return `${Number.isInteger(Math.round(p * 10) / 10) ? Math.round(p) : (Math.round(p * 10) / 10).toFixed(1)}%`;
  }
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

/** Redondeo "bonito" para el borde de un rango: 2,000 / 2,500 / 3,000… (de 0.5 en 0.5 si empieza en 1, si no de 1 en 1). */
function bonito(v: number): number {
  if (v === 0) return 0;
  const f = 10 ** Math.floor(Math.log10(Math.abs(v)));
  const m = v / f;
  const paso = Math.abs(m) < 2 ? 0.5 : 1;
  return Math.round((Math.round(m / paso) * paso * f) * 1e6) / 1e6;
}

const SI = /^(si|sí|s|yes|y|x|1|verdadero|true)$/i;
const NO = /^(no|n|0|falso|false)$/i;

function etiquetaValor(columna: string, valor: string | number, escala: number): string {
  if (typeof valor === "number") return `${corto(columna)} ${numeroTxt(columna, valor, escala)}`;
  const v = valor.trim().replace(/\s+/g, " ");
  if (SI.test(v)) return legible(columna);
  if (NO.test(v)) return `${legible(columna)}: No`;
  // Valores cortos o de código ("P1", "A", "3"): con el nombre de la columna ("Perfil P1").
  if (v.length <= 3 || /^[\d.,%$-]+$/.test(v)) return `${corto(columna)} ${v}`;
  return v === v.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{4,}/.test(v) ? titleCase(v) : v;
}

interface Conteo {
  clientes: number;
  contactados: number;
  ventas: number;
}
const vacio = (): Conteo => ({ clientes: 0, contactados: 0, ventas: 0 });
const sumar = (a: Conteo, b: Conteo) => ((a.clientes += b.clientes), (a.contactados += b.contactados), (a.ventas += b.ventas), a);

/** Rangos de una columna numérica: hasta 4, con bordes en los cuartiles (redondeados). */
function rangos(columna: string, valores: [number, Conteo][]): { label: string; c: Conteo }[] {
  const orden = [...valores].sort((a, b) => a[0] - b[0]);
  const total = orden.reduce((t, [, c]) => t + c.clientes, 0);
  const max = orden.at(-1)![0];
  // Tasas guardadas como fracción (0.18) se muestran como porcentaje.
  const escala = esTasa(columna) && max <= 1 ? 100 : 1;
  const cortes: number[] = [];
  let acum = 0;
  let q = 1;
  for (const [v, c] of orden) {
    acum += c.clientes;
    while (q <= 3 && acum >= (total * q) / 4) {
      const b = bonito(v);
      if (b > orden[0]![0] && b < max && !cortes.includes(b)) cortes.push(b);
      q++;
    }
  }
  cortes.sort((a, b) => a - b);
  if (!cortes.length) return [];
  const out = Array.from({ length: cortes.length + 1 }, () => vacio());
  for (const [v, c] of orden) {
    let i = cortes.findIndex((b) => v < b);
    if (i < 0) i = cortes.length;
    sumar(out[i]!, c);
  }
  const t = (v: number) => numeroTxt(columna, v, escala);
  const nombre = corto(columna);
  return out.map((c, i) => {
    let label: string;
    if (i === 0) label = `${nombre} hasta ${t(cortes[0]!)}`;
    else if (i === cortes.length) label = `${nombre} mayor a ${t(cortes[i - 1]!)}`;
    else {
      const a = t(cortes[i - 1]!);
      const b = t(cortes[i]!);
      // "$2K-5K": el símbolo y la unidad una sola vez cuando se repiten.
      label = esDinero(columna) && a.endsWith("K") && b.endsWith("K") ? `${nombre} ${a}-${b.slice(1)}` : `${nombre} ${a}-${b}`;
    }
    return { label, c };
  });
}

/**
 * Segmentos con suficientes clientes para que la cifra diga algo, de menor a mayor conversión.
 * `conRemanente`: también los clientes del remanente del mes anterior (Extra: "bases sep y oct").
 */
export function segmentosConversion(filas: PresSegmentoFila[], conRemanente = false): Segmento[] {
  const porColumna = new Map<string, Map<string | number, Conteo>>();
  for (const f of filas) {
    if (f.rem === 1 && !conRemanente) continue;
    if (!esColumnaDeSegmento(f.columna)) continue;
    const m = porColumna.get(f.columna) ?? new Map<string | number, Conteo>();
    porColumna.set(f.columna, m);
    const key = typeof f.valor === "string" ? f.valor.trim() : f.valor;
    if (key === "") continue;
    sumar(m.get(key) ?? (m.set(key, vacio()), m.get(key)!), f);
  }

  const candidatos: Segmento[] = [];
  let totalContactados = 0;
  for (const [columna, valores] of porColumna) {
    const entradas = [...valores.entries()];
    const total = entradas.reduce((t, [, c]) => t + c.clientes, 0);
    const contactados = entradas.reduce((t, [, c]) => t + c.contactados, 0);
    totalContactados = Math.max(totalContactados, contactados);
    if (!total) continue;
    const numericos = entradas.filter((e): e is [number, Conteo] => typeof e[0] === "number");
    const enNumeros = numericos.reduce((t, [, c]) => t + c.clientes, 0);
    let grupos: { label: string; c: Conteo }[];
    if (enNumeros >= total * 0.9 && numericos.length > 8) {
      // Números que identifican (teléfonos, cuentas, NIU en número): no son segmentos.
      const medio = [...numericos].sort((a, b) => a[0] - b[0])[Math.floor(numericos.length / 2)]![0];
      if (Math.abs(medio) >= 1_000_000) continue;
      grupos = rangos(columna, numericos);
    } else if (entradas.length <= 25) {
      const max = Math.max(...numericos.map(([v]) => v), 0);
      const escala = esTasa(columna) && max <= 1 ? 100 : 1;
      grupos = entradas.map(([v, c]) => ({ label: etiquetaValor(columna, v, escala), c }));
    } else continue;
    for (const g of grupos) {
      const share = g.c.clientes / total;
      // Un segmento que es casi toda la base (o casi nadie) no dice nada.
      if (share < 0.02 || share > 0.97) continue;
      candidatos.push({ label: g.label, columna, ...g.c, conv: g.c.contactados ? (g.c.ventas / g.c.contactados) * 100 : 0 });
    }
  }
  const minimo = Math.max(10, totalContactados * 0.02);
  const vistos = new Map<string, Segmento>();
  for (const s of candidatos) {
    if (s.contactados < minimo) continue;
    // La misma etiqueta desde dos columnas (p. ej. "Platinum"): se queda la de más contactados.
    const prev = vistos.get(s.label.toLowerCase());
    if (!prev || prev.contactados < s.contactados) vistos.set(s.label.toLowerCase(), s);
  }
  return [...vistos.values()].sort((a, b) => a.conv - b.conv || b.contactados - a.contactados);
}

/** Lo que va en la gráfica: los 5 que menos convierten y los 5 que más, de menor a mayor. */
export function extremos(segmentos: Segmento[], n = 5): Segmento[] {
  return segmentos.length <= n * 2 ? segmentos : [...segmentos.slice(0, n), ...segmentos.slice(-n)];
}
