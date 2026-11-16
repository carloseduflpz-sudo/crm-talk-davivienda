/* Lectura ligera de hojas .xlsx muy grandes (por ejemplo, el histórico de tipificaciones de VICI con cientos
   de miles de llamadas). En lugar de abrir el libro entero con SheetJS —que guarda cada celda de cada columna
   y se puede quedar sin memoria—, la hoja se descomprime por partes y de cada fila se guardan solo las
   columnas que el tipo de archivo usa. El resultado son las mismas filas (con solo esas columnas), listas
   para el mismo lector de siempre. Si algo no se puede leer así (xlsb, libro raro), devuelve null y se usa
   el camino normal. */
import { readZip, type LibroEntrada } from "./compactar";
import { normHeader } from "./importers";

/** Solo se usa con hojas que descomprimidas pesan más que esto; las demás van por el camino normal. */
export const HOJA_GRANDE_BYTES = 25 * 1024 * 1024;
/** Filas no vacías en las que se busca la fila de encabezados. */
const FILAS_ENCABEZADO = 15;

type Celda = string | number | boolean | null;

async function inflar(buf: Uint8Array, e: LibroEntrada): Promise<Uint8Array> {
  const comp = buf.subarray(e.dataStart, e.dataStart + e.compSize);
  if (e.method === 0) return comp;
  const res = new Response(new Blob([comp as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")));
  return new Uint8Array(await res.arrayBuffer());
}

function trozos(buf: Uint8Array, e: LibroEntrada): ReadableStream<Uint8Array> {
  const comp = buf.subarray(e.dataStart, e.dataStart + e.compSize);
  const s = new Blob([comp as BlobPart]).stream();
  return e.method === 0 ? s : s.pipeThrough(new DecompressionStream("deflate-raw"));
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function texto(x: string): string {
  if (x.indexOf("&") < 0 && x.indexOf("_x") < 0) return x;
  return x
    .replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (m, hex, dec, name) =>
      hex ? String.fromCodePoint(parseInt(hex, 16)) : dec ? String.fromCodePoint(Number(dec)) : (ENT[name] ?? m),
    )
    .replace(/_x([0-9a-f]{4})_/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

/** Texto de un <si> o <is>: todas sus partes <t>, sin la guía fonética (<rPh>). */
function textoRico(xml: string): string {
  const sinFon = xml.indexOf("rPh") >= 0 ? xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/g, "") : xml;
  let out = "";
  const re = /<(?:\w+:)?t\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sinFon))) out += m[1] ?? "";
  return texto(out);
}

function atributo(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? m[1]! : null;
}

/** "AB12" → 27 (columna, desde 0). */
function columna(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Hojas del libro: nombre → archivo de la hoja dentro del zip. */
async function hojasDelLibro(buf: Uint8Array, entries: LibroEntrada[]): Promise<Map<string, string> | null> {
  const dec = new TextDecoder();
  const wbE = entries.find((e) => /^xl\/workbook\.xml$/i.test(e.name));
  const relE = entries.find((e) => /^xl\/_rels\/workbook\.xml\.rels$/i.test(e.name));
  if (!wbE || !relE) return null;
  const wb = dec.decode(await inflar(buf, wbE));
  const rels = dec.decode(await inflar(buf, relE));
  const destino = new Map<string, string>();
  for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*)\/?>/g)) {
    const id = atributo(m[1]!, "Id");
    const t = atributo(m[1]!, "Target");
    if (id && t) destino.set(id, t.startsWith("/") ? t.slice(1) : `xl/${t}`);
  }
  const out = new Map<string, string>();
  for (const m of wb.matchAll(/<(?:\w+:)?sheet\b([^>]*)\/?>/g)) {
    const name = atributo(m[1]!, "name");
    const rid = /\b(?:\w+:)?id="([^"]*)"/.exec(m[1]!)?.[1];
    const t = rid ? destino.get(rid) : undefined;
    if (name !== null && t) out.set(texto(name), t);
  }
  return out;
}

async function textosCompartidos(buf: Uint8Array, entries: LibroEntrada[]): Promise<string[]> {
  const e = entries.find((x) => /^xl\/sharedStrings\.xml$/i.test(x.name));
  if (!e) return [];
  const out: string[] = [];
  const dec = new TextDecoder();
  const reader = trozos(buf, e).getReader();
  let resto = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) resto += dec.decode(value, { stream: true });
    if (done) resto += dec.decode();
    const re = /<(?:\w+:)?si\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?si>)/g;
    let m: RegExpExecArray | null;
    let fin = 0;
    while ((m = re.exec(resto))) {
      out.push(m[1] === undefined ? "" : textoRico(m[1]));
      fin = re.lastIndex;
    }
    resto = resto.slice(fin);
    if (done) break;
  }
  return out;
}

function valor(attrs: string, inner: string | undefined, sst: string[]): Celda {
  if (inner === undefined) return null;
  const t = atributo(attrs, "t");
  if (t === "inlineStr") {
    const is = /<(?:\w+:)?is\b[^>]*>([\s\S]*?)<\/(?:\w+:)?is>/.exec(inner);
    return is ? textoRico(is[1]!) : null;
  }
  const v = /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(inner);
  if (!v) return null;
  const raw = v[1]!;
  if (t === "s") return sst[Number(raw)] ?? "";
  if (t === "str" || t === "d") return texto(raw);
  if (t === "b") return raw === "1" || raw === "true";
  if (t === "e") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : texto(raw);
}

/**
 * Filas (con solo las columnas que se usan) de cada hoja pedida, o null si conviene el camino normal:
 * hojas chicas, .xlsb, o un libro que no se pudo leer así.
 */
export async function leerHojasLigero(
  data: Uint8Array,
  hojas: string[],
  usadas: { requeridas: (string | string[])[]; columnas: Set<string> },
  opts: { minBytes?: number } = {},
): Promise<Map<string, Celda[][]> | null> {
  if (typeof DecompressionStream === "undefined" || !hojas.length) return null;
  const entries = readZip(data);
  if (!entries) return null;
  const mapa = await hojasDelLibro(data, entries);
  if (!mapa) return null;
  const porHoja = hojas.map((h) => ({ h, e: entries.find((x) => x.name.toLowerCase() === (mapa.get(h) ?? "").toLowerCase()) }));
  if (porHoja.some((x) => !x.e || !/\.xml$/i.test(x.e.name) || (x.e.method !== 0 && x.e.method !== 8))) return null;
  if (!porHoja.some((x) => x.e!.size >= (opts.minBytes ?? HOJA_GRANDE_BYTES))) return null;

  const sst = await textosCompartidos(data, entries);
  const req = usadas.requeridas.map((r) => (Array.isArray(r) ? r : [r]).map(normHeader));
  const out = new Map<string, Celda[][]>();
  for (const { h, e } of porHoja) {
    const filas = await leerHoja(data, e!, sst, req, usadas.columnas);
    if (!filas) return null;
    out.set(h, filas);
  }
  return out;
}

async function leerHoja(data: Uint8Array, e: LibroEntrada, sst: string[], req: string[][], columnas: Set<string>): Promise<Celda[][] | null> {
  const dec = new TextDecoder();
  const reader = trozos(data, e).getReader();
  const filas: Celda[][] = [];
  // Antes de encontrar los encabezados se guardan las filas completas (columna → valor).
  const previas: Map<number, Celda>[] = [];
  let guardar: number[] | null = null;
  let guardarSet = new Set<number>();
  let resto = "";
  const rowRe = /<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g;
  const cRe = /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g;

  const compacta = (fila: Map<number, Celda>) => guardar!.map((j) => fila.get(j) ?? null);
  const buscarEncabezados = () => {
    for (const fila of previas) {
      const nombres = new Map<string, number>();
      for (const [j, v] of fila) {
        const k = normHeader(v);
        if (k && !nombres.has(k)) nombres.set(k, j);
      }
      if (req.every((alts) => alts.some((a) => nombres.has(a)))) {
        guardar = [...new Set([...nombres].filter(([k]) => columnas.has(k)).map(([, j]) => j))].sort((x, y) => x - y);
        guardarSet = new Set(guardar);
        return true;
      }
    }
    return false;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (value) resto += dec.decode(value, { stream: true });
    if (done) resto += dec.decode();
    rowRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    let fin = 0;
    while ((m = rowRe.exec(resto))) {
      fin = rowRe.lastIndex;
      const inner = m[1];
      if (!inner) continue;
      const fila = new Map<number, Celda>();
      let col = -1;
      cRe.lastIndex = 0;
      let c: RegExpExecArray | null;
      let conValor = false;
      while ((c = cRe.exec(inner))) {
        const ref = atributo(c[1]!, "r");
        col = ref ? columna(ref) : col + 1;
        const v = valor(c[1]!, c[2], sst);
        if (v !== null) {
          conValor = true;
          // Ya con los encabezados, solo se guardan las columnas que se usan.
          if (!guardar || guardarSet.has(col)) fila.set(col, v);
        }
      }
      // Como SheetJS (blankrows: false): las filas sin ningún valor no cuentan.
      if (!conValor) continue;
      if (guardar) {
        filas.push(compacta(fila));
      } else {
        previas.push(fila);
        if (previas.length >= FILAS_ENCABEZADO) {
          if (!buscarEncabezados()) return null;
          for (const p of previas) filas.push(compacta(p));
          previas.length = 0;
        }
      }
    }
    resto = resto.slice(fin);
    if (done) break;
  }
  if (!guardar) {
    if (!buscarEncabezados()) return null;
    for (const p of previas) filas.push(compacta(p));
  }
  return filas;
}
