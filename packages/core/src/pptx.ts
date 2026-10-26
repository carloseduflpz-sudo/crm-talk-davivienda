/* Presentación: se llena la plantilla .pptx del usuario SIN tocar su diseño. Solo cambian valores dentro de lo
   que ya existe: el texto de celdas de tablas (copiando el formato de la celda), los datos guardados de las
   gráficas (categorías y valores) y textos sueltos (p. ej. la "M" y la "R" de un SmartArt). Todo lo demás del
   archivo se copia byte por byte. */

/* ---------- ZIP completo (lectura y escritura) ---------- */

interface ZipPart {
  name: string;
  flags: number;
  method: number;
  crc: number;
  size: number;
  /** Bytes comprimidos tal como venían (se copian si la parte no cambia). */
  raw: Uint8Array;
  time: number;
  date: number;
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

function readParts(buf: Uint8Array): ZipPart[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (u32(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("El archivo no es un PowerPoint (.pptx) válido.");
  const count = u16(buf, eocd + 10);
  let p = u32(buf, eocd + 16);
  const dec = new TextDecoder();
  const out: ZipPart[] = [];
  for (let i = 0; i < count; i++) {
    if (u32(buf, p) !== 0x02014b50) throw new Error("El PowerPoint está dañado.");
    const flags = u16(buf, p + 8);
    const method = u16(buf, p + 10);
    const time = u16(buf, p + 12);
    const date = u16(buf, p + 14);
    const crc = u32(buf, p + 16);
    const compSize = u32(buf, p + 20);
    const size = u32(buf, p + 24);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const local = u32(buf, p + 42);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + u16(buf, local + 26) + u16(buf, local + 28);
    out.push({ name, flags: flags & 0x800, method, crc, size, raw: buf.subarray(start, start + compSize), time, date });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

let CRC: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!CRC) {
    CRC = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function inflate(raw: Uint8Array, method: number): Promise<Uint8Array> {
  if (method === 0) return raw;
  return new Uint8Array(await new Response(new Blob([raw as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
}
async function deflate(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await new Response(new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
}

function writeParts(parts: ZipPart[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const p of parts) {
    const name = enc.encode(p.name);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, p.flags, true);
    lv.setUint16(8, p.method, true);
    lv.setUint16(10, p.time, true);
    lv.setUint16(12, p.date, true);
    lv.setUint32(14, p.crc, true);
    lv.setUint32(18, p.raw.length, true);
    lv.setUint32(22, p.size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, p.flags, true);
    cv.setUint16(10, p.method, true);
    cv.setUint16(12, p.time, true);
    cv.setUint16(14, p.date, true);
    cv.setUint32(16, p.crc, true);
    cv.setUint32(20, p.raw.length, true);
    cv.setUint32(24, p.size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    chunks.push(local, p.raw);
    central.push(cd);
    offset += local.length + p.raw.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, parts.length, true);
  ev.setUint16(10, parts.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let o = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/* ---------- el paquete ---------- */

export class Pptx {
  private texts = new Map<string, string>();
  private changed = new Set<string>();
  private constructor(private parts: ZipPart[]) {}

  static open(bytes: Uint8Array): Pptx {
    const parts = readParts(bytes);
    if (!parts.some((p) => p.name === "ppt/presentation.xml")) throw new Error("El archivo no es una presentación de PowerPoint (.pptx).");
    return new Pptx(parts);
  }

  has(name: string): boolean {
    return this.parts.some((p) => p.name === name);
  }

  /** Contenido de texto de una parte (XML). */
  async read(name: string): Promise<string> {
    const cached = this.texts.get(name);
    if (cached !== undefined) return cached;
    const p = this.parts.find((x) => x.name === name);
    if (!p) throw new Error(`La presentación no tiene ${name}.`);
    const text = new TextDecoder().decode(await inflate(p.raw, p.method));
    this.texts.set(name, text);
    return text;
  }

  write(name: string, xml: string): void {
    if (!this.has(name)) throw new Error(`La presentación no tiene ${name}.`);
    if (this.texts.get(name) === xml) return;
    this.texts.set(name, xml);
    this.changed.add(name);
  }

  /** Partes modificadas (para mostrar qué se tocó). */
  get modified(): string[] {
    return [...this.changed];
  }

  /** Relaciones de una parte: id → ruta completa del destino (o la URL si es externa). */
  async rels(name: string): Promise<{ id: string; type: string; target: string; external: boolean }[]> {
    const i = name.lastIndexOf("/");
    const relName = `${name.slice(0, i)}/_rels/${name.slice(i + 1)}.rels`;
    if (!this.has(relName)) return [];
    const xml = await this.read(relName);
    const out: { id: string; type: string; target: string; external: boolean }[] = [];
    for (const m of xml.matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const attr = (k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(m[1]!)?.[1] ?? "";
      const external = attr("TargetMode") === "External";
      const t = attr("Target");
      out.push({ id: attr("Id"), type: attr("Type").split("/").pop() ?? "", target: external ? t : resolvePath(name.slice(0, i), t), external });
    }
    return out;
  }

  /** Láminas en el orden de la presentación. */
  async slides(): Promise<string[]> {
    const pres = await this.read("ppt/presentation.xml");
    const rels = await this.rels("ppt/presentation.xml");
    const ids = [...pres.matchAll(/<p:sldId\b[^>]*r:id="([^"]+)"/g)].map((m) => m[1]!);
    return ids.map((id) => rels.find((r) => r.id === id)!.target).filter(Boolean);
  }

  async save(): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const out: ZipPart[] = [];
    for (const p of this.parts) {
      if (!this.changed.has(p.name)) {
        out.push(p);
        continue;
      }
      const data = enc.encode(this.texts.get(p.name)!);
      out.push({ ...p, method: 8, crc: crc32(data), size: data.length, raw: await deflate(data) });
    }
    return writeParts(out);
  }
}

function resolvePath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const parts = base.split("/");
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/* ---------- texto XML ---------- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&");

/** Bloques <tag ...>...</tag> de primer nivel dentro de `xml` (sin anidar el mismo tag). */
function blocks(xml: string, tag: string): { start: number; end: number; xml: string }[] {
  const out: { start: number; end: number; xml: string }[] = [];
  const open = new RegExp(`<${tag}(?=[\\s>/])`, "g");
  const close = `</${tag}>`;
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml))) {
    const start = m.index;
    const selfClose = xml.indexOf(">", start);
    if (xml[selfClose - 1] === "/") {
      out.push({ start, end: selfClose + 1, xml: xml.slice(start, selfClose + 1) });
      open.lastIndex = selfClose + 1;
      continue;
    }
    // Cierre correspondiente (contando anidados del mismo tag).
    let depth = 1;
    let i = selfClose + 1;
    const any = new RegExp(`<${tag}(?=[\\s>/])|${close.replace(/[/]/g, "\\/")}`, "g");
    any.lastIndex = i;
    let n: RegExpExecArray | null;
    while ((n = any.exec(xml))) {
      if (n[0] === close) depth--;
      else {
        const gt = xml.indexOf(">", n.index);
        if (xml[gt - 1] !== "/") depth++;
      }
      if (depth === 0) {
        i = n.index + close.length;
        break;
      }
    }
    out.push({ start, end: i, xml: xml.slice(start, i) });
    open.lastIndex = i;
  }
  return out;
}

/** Texto visible de un fragmento (todas las <a:t>, párrafos separados por salto de línea). */
export function plainText(xml: string): string {
  return blocks(xml, "a:p")
    .map((p) => [...p.xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => unesc(m[1]!)).join(""))
    .join("\n")
    .trim();
}

/** Cambia el texto de un cuerpo de texto (<a:txBody> o <p:txBody>) conservando el formato del primer texto. */
function setBodyText(body: string, text: string): string {
  const paras = blocks(body, "a:p");
  if (!paras.length) return body;
  const first = paras[0]!.xml;
  const pPr = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/.exec(first)?.[0] ?? "";
  const rPr =
    /<a:rPr\b[^>]*\/>|<a:rPr\b[^>]*>[\s\S]*?<\/a:rPr>/.exec(first)?.[0] ??
    (/<a:endParaRPr\b([^>]*?)(\/>|>[\s\S]*?<\/a:endParaRPr>)/.exec(first)?.[0] ?? "").replace(/<a:endParaRPr/, "<a:rPr").replace(/<\/a:endParaRPr>/, "</a:rPr>");
  const end = /<a:endParaRPr\b[^>]*\/>|<a:endParaRPr\b[^>]*>[\s\S]*?<\/a:endParaRPr>/.exec(paras[paras.length - 1]!.xml)?.[0] ?? "";
  const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : "";
  const p = `<a:p>${pPr}${text === "" ? "" : `<a:r>${rPr}<a:t${space}>${esc(text)}</a:t></a:r>`}${end}</a:p>`;
  return body.slice(0, paras[0]!.start) + p + body.slice(paras[paras.length - 1]!.end);
}

/* ---------- tablas ---------- */

export interface TableInfo {
  /** Posición entre las tablas de la lámina (0, 1, ...). */
  index: number;
  /** Texto de cada celda por fila. */
  cells: string[][];
}

function tablesIn(slide: string) {
  return blocks(slide, "p:graphicFrame")
    .map((f) => ({ frame: f, tbl: blocks(f.xml, "a:tbl")[0] }))
    .filter((x): x is { frame: { start: number; end: number; xml: string }; tbl: { start: number; end: number; xml: string } } => Boolean(x.tbl));
}

const rowsOf = (tbl: string) => blocks(tbl, "a:tr");
const cellsOf = (tr: string) => blocks(tr, "a:tc");

export function readTables(slide: string): TableInfo[] {
  return tablesIn(slide).map((t, index) => ({ index, cells: rowsOf(t.tbl.xml).map((r) => cellsOf(r.xml).map((c) => plainText(c.xml))) }));
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Tabla cuyo texto de la primera fila (o de las primeras dos) contiene `header`. */
export function findTable(slide: string, header: string): TableInfo | null {
  const h = norm(header);
  return readTables(slide).find((t) => t.cells.slice(0, 2).some((row) => norm(row.join(" ")).includes(h))) ?? null;
}

export interface TableFill {
  /** Filas de encabezado que no se tocan. */
  headerRows: number;
  /** Filas de datos: un texto por columna (undefined = se deja lo que había). */
  rows: (string | undefined)[][];
  /** Fila final de total con su propio formato (la última fila de la plantilla). */
  total?: (string | undefined)[];
}

function fillRow(tr: string, values: (string | undefined)[]): string {
  const cells = cellsOf(tr);
  let out = "";
  let last = 0;
  cells.forEach((c, j) => {
    out += tr.slice(last, c.start);
    const v = values[j];
    // Celdas combinadas (continuación) no tienen texto propio.
    if (v === undefined || /<a:tc\b[^>]*\b(hMerge|vMerge)="1"/.test(c.xml)) out += c.xml;
    else {
      const body = blocks(c.xml, "a:txBody")[0];
      out += body ? c.xml.slice(0, body.start) + setBodyText(body.xml, v) + c.xml.slice(body.end) : c.xml;
    }
    last = c.end;
  });
  return out + tr.slice(last);
}

/** Llena la tabla `index` de la lámina: agrega o quita filas copiando las de la plantilla y ajusta el alto del marco. */
export function fillTable(slide: string, index: number, fill: TableFill): string {
  const t = tablesIn(slide)[index];
  if (!t) throw new Error(`La lámina no tiene la tabla ${index + 1}.`);
  const rows = rowsOf(t.tbl.xml);
  const head = rows.slice(0, fill.headerRows);
  const bodyTpl = rows.slice(fill.headerRows, fill.total ? rows.length - 1 : rows.length);
  const totalTpl = fill.total ? rows[rows.length - 1] : undefined;
  if (!bodyTpl.length && fill.rows.length) throw new Error("La tabla de la plantilla no tiene filas de datos para copiar.");
  const newRows = [
    ...head.map((r) => r.xml),
    ...fill.rows.map((vals, i) => fillRow((bodyTpl[i] ?? bodyTpl[bodyTpl.length - 1]!).xml, vals)),
    ...(totalTpl && fill.total ? [fillRow(totalTpl.xml, fill.total)] : []),
  ];
  const tbl = t.tbl.xml.slice(0, rows[0]!.start) + newRows.join("") + t.tbl.xml.slice(rows[rows.length - 1]!.end);
  let frame = t.frame.xml.slice(0, t.tbl.start) + tbl + t.frame.xml.slice(t.tbl.end);
  // El marco de la tabla mide lo que suman sus filas.
  const height = newRows.reduce((s, r) => s + Number(/<a:tr\b[^>]*\bh="(\d+)"/.exec(r)?.[1] ?? 0), 0);
  if (height && newRows.length !== rows.length) frame = frame.replace(/(<p:xfrm>[\s\S]*?<a:ext\b[^>]*\bcy=")(\d+)(")/, `$1${height}$3`);
  return slide.slice(0, t.frame.start) + frame + slide.slice(t.frame.end);
}

/* ---------- gráficas ---------- */

export interface ChartSeries {
  name: string;
  categories: string[];
  values: (number | null)[];
}

function cachePoints(cache: string): { count: number; pts: Map<number, string> } {
  const count = Number(/<c:ptCount val="(\d+)"/.exec(cache)?.[1] ?? 0);
  const pts = new Map<number, string>();
  for (const m of cache.matchAll(/<c:pt idx="(\d+)"[^>]*>\s*<c:v>([^<]*)<\/c:v>/g)) pts.set(Number(m[1]), unesc(m[2]!));
  return { count, pts };
}

export function readChart(chart: string): ChartSeries[] {
  return blocks(chart, "c:ser").map((s) => {
    const tx = blocks(s.xml, "c:tx")[0]?.xml ?? "";
    const name = cachePoints(tx).pts.get(0) ?? plainText(tx);
    const cat = blocks(s.xml, "c:cat")[0]?.xml ?? "";
    const val = blocks(s.xml, "c:val")[0]?.xml ?? "";
    const c = cachePoints(cat);
    const v = cachePoints(val);
    const n = Math.max(c.count, v.count);
    return {
      name,
      categories: Array.from({ length: n }, (_, i) => c.pts.get(i) ?? ""),
      values: Array.from({ length: n }, (_, i) => (v.pts.has(i) && v.pts.get(i) !== "" ? Number(v.pts.get(i)) : null)),
    };
  });
}

function rewriteCache(block: string, items: (string | number | null)[], numeric: boolean): string {
  const cacheTag = numeric ? "c:numCache" : "c:strCache";
  const caches = blocks(block, "c:numCache").concat(blocks(block, "c:strCache"));
  if (!caches.length) return block;
  const cache = caches[0]!;
  const tag = cache.xml.startsWith("<c:numCache") ? "c:numCache" : "c:strCache";
  const formatCode = /<c:formatCode>[\s\S]*?<\/c:formatCode>/.exec(cache.xml)?.[0] ?? (tag === "c:numCache" && numeric ? "<c:formatCode>General</c:formatCode>" : "");
  const pts = items
    .map((v, i) => (v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v)) ? "" : `<c:pt idx="${i}"><c:v>${esc(String(v))}</c:v></c:pt>`))
    .join("");
  const ext = /<c:extLst>[\s\S]*?<\/c:extLst>/.exec(cache.xml)?.[0] ?? "";
  const xml = `<${tag}>${tag === "c:numCache" ? formatCode : ""}<c:ptCount val="${items.length}"/>${pts}${ext}</${tag}>`;
  void cacheTag;
  return block.slice(0, cache.start) + xml + block.slice(cache.end);
}

/** Cambia los datos guardados de cada serie (en orden). Lo que no se da, se deja. */
export function fillChart(chart: string, series: { name?: string; categories?: string[]; values?: (number | null)[] }[]): string {
  const sers = blocks(chart, "c:ser");
  let out = "";
  let last = 0;
  sers.forEach((s, i) => {
    out += chart.slice(last, s.start);
    const f = series[i];
    let xml = s.xml;
    if (f) {
      if (f.name !== undefined) {
        const tx = blocks(xml, "c:tx")[0];
        if (tx) xml = xml.slice(0, tx.start) + rewriteCache(tx.xml, [f.name], false) + xml.slice(tx.end);
      }
      if (f.categories) {
        const cat = blocks(xml, "c:cat")[0];
        if (cat) xml = xml.slice(0, cat.start) + rewriteCache(cat.xml, f.categories, false) + xml.slice(cat.end);
      }
      if (f.values) {
        const val = blocks(xml, "c:val")[0];
        if (val) xml = xml.slice(0, val.start) + rewriteCache(val.xml, f.values, true) + xml.slice(val.end);
      }
    }
    out += xml;
    last = s.end;
  });
  return out + chart.slice(last);
}

/** Título de la gráfica (texto). */
export function chartTitle(chart: string): string {
  const t = blocks(chart, "c:title")[0];
  return t ? plainText(t.xml) : "";
}

/** Cambia el título conservando su formato. */
export function setChartTitle(chart: string, text: string): string {
  const t = blocks(chart, "c:title")[0];
  if (!t) return chart;
  const rich = blocks(t.xml, "c:rich")[0];
  if (!rich) return chart;
  const xml = t.xml.slice(0, rich.start) + setBodyText(rich.xml, text) + t.xml.slice(rich.end);
  return chart.slice(0, t.start) + xml + chart.slice(t.end);
}

/* ---------- textos sueltos ---------- */

/** Reemplaza el texto de cada <a:t> que dice exactamente `from` (p. ej. el valor de la "M" en un SmartArt). */
export function replaceExactText(xml: string, from: string, to: string): { xml: string; count: number } {
  let count = 0;
  const out = xml.replace(/(<a:t(?:\s[^>]*)?>)([^<]*)(<\/a:t>)/g, (all, a: string, t: string, b: string) => {
    if (unesc(t) !== from) return all;
    count++;
    return a + esc(to) + b;
  });
  return { xml: out, count };
}

/** Textos (<a:t>) en orden. */
export function texts(xml: string): string[] {
  return [...xml.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>/g)].map((m) => unesc(m[1]!));
}
