/* Compactación de libros de Excel con "colas" enormes de filas vacías.
   Las bases del banco suelen traer la hoja con formato hasta la fila 1 048 576: un .xlsb de 10 MB
   que por dentro ocupa ~1 GB y tarda más de un minuto en abrirse, aunque los datos sean 4 000 filas.
   Aquí se descomprime la hoja por partes y se corta donde terminan los datos (después de una
   racha larga de filas sin ningún valor). El resto del libro queda intacto y el resultado se lee
   igual que el original, pero en segundos.
   Solo se usa DecompressionStream ("deflate-raw"), disponible en navegadores, Web Workers y Node 18+. */

/** Filas seguidas sin ningún valor a partir de las cuales se considera que los datos terminaron. */
export const EMPTY_GAP = 20_000;
/** Solo se intenta con hojas que descomprimidas pesan más que esto. */
export const MIN_SHEET_BYTES = 40 * 1024 * 1024;

interface Entry {
  name: string;
  method: number;
  crc: number;
  compSize: number;
  size: number;
  localOffset: number;
  dataStart: number;
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

/** Lee el directorio del zip. Devuelve null si no es un zip simple (por ejemplo ZIP64). */
function readZip(buf: Uint8Array): Entry[] | null {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (u32(buf, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = u16(buf, eocd + 10);
  const cdOffset = u32(buf, eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) return null;
  const out: Entry[] = [];
  let p = cdOffset;
  const dec = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(buf, p) !== 0x02014b50) return null;
    const method = u16(buf, p + 10);
    const crc = u32(buf, p + 16);
    const compSize = u32(buf, p + 20);
    const size = u32(buf, p + 24);
    const nameLen = u16(buf, p + 28);
    const extraLen = u16(buf, p + 30);
    const commentLen = u16(buf, p + 32);
    const localOffset = u32(buf, p + 42);
    if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) return null;
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    if (u32(buf, localOffset) !== 0x04034b50) return null;
    const dataStart = localOffset + 30 + u16(buf, localOffset + 26) + u16(buf, localOffset + 28);
    out.push({ name, method, crc, compSize, size, localOffset, dataStart });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

let CRC_TABLE: Uint32Array | null = null;
function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ---------- lectura por partes ---------- */

/** Búfer que crece a medida que llegan pedazos descomprimidos. */
class Grow {
  buf = new Uint8Array(1 << 20);
  len = 0;
  push(chunk: Uint8Array) {
    if (this.len + chunk.length > this.buf.length) {
      let cap = this.buf.length * 2;
      while (cap < this.len + chunk.length) cap *= 2;
      const n = new Uint8Array(cap);
      n.set(this.buf.subarray(0, this.len));
      this.buf = n;
    }
    this.buf.set(chunk, this.len);
    this.len += chunk.length;
  }
}

/** Descomprime y llama a `scan` con lo acumulado; si `scan` devuelve un corte, se detiene ahí. */
async function inflateUntil(compressed: Uint8Array, scan: (g: Grow, done: boolean) => number | "fin" | null): Promise<{ data: Grow; cut: number } | null> {
  const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const g = new Grow();
  for (;;) {
    const { value, done } = await reader.read();
    if (value) g.push(value);
    const r = scan(g, done);
    if (r === "fin") {
      await reader.cancel().catch(() => {});
      return null;
    }
    if (typeof r === "number") {
      await reader.cancel().catch(() => {});
      return { data: g, cut: r };
    }
    if (done) return null;
  }
}

/** Hoja .bin (XLSB): registros BIFF12. Devuelve el byte donde cortar, "fin" si no hace falta, o null para seguir. */
function xlsbScanner(gap: number) {
  let pos = 0;
  let row = -1;
  let lastValueRow = -1;
  return (g: Grow, done: boolean): number | "fin" | null => {
    const b = g.buf;
    for (;;) {
      const start = pos;
      let p = pos;
      if (p >= g.len) break;
      let id = b[p]! & 0x7f;
      if (b[p++]! & 0x80) {
        if (p >= g.len) break;
        id |= (b[p]! & 0x7f) << 7;
        p++;
      }
      let size = 0;
      let shift = 0;
      let complete = false;
      for (let k = 0; k < 4; k++) {
        if (p >= g.len) break;
        const byte = b[p++]!;
        size |= (byte & 0x7f) << shift;
        shift += 7;
        if (!(byte & 0x80)) {
          complete = true;
          break;
        }
      }
      if (!complete || p + size > g.len) break; // falta llegar más
      if (id === 0 && size >= 4) {
        // BrtRowHdr: número de fila
        const rw = u32(b, p);
        if (lastValueRow >= 0 && rw - lastValueRow > gap) return start;
        row = rw;
      } else if ((id >= 2 && id <= 11) || (id >= 13 && id <= 18)) {
        lastValueRow = row; // celda con valor (1 y 12 son celdas vacías con formato)
      } else if (id === 146) {
        return "fin"; // BrtEndSheetData: los datos terminan solos, no hace falta cortar
      }
      pos = p + size;
    }
    return done ? "fin" : null;
  };
}

/** Registros que cierran la hoja después del corte: BrtEndSheetData (146) y BrtEndSheet (130). */
const XLSB_TAIL = new Uint8Array([0x92, 0x01, 0x00, 0x82, 0x01, 0x00]);

/** Hoja .xml (XLSX): se busca fila por fila si trae algún valor. */
function xlsxScanner(gap: number) {
  const dec = new TextDecoder();
  let decodedBytes = 0;
  let text = "";
  let scanFrom = 0;
  let row = 0;
  let lastValueRow = -1;
  let prefix = "";
  return (g: Grow, done: boolean): number | "fin" | null => {
    if (g.len > decodedBytes) {
      text += dec.decode(g.buf.subarray(decodedBytes, g.len), { stream: !done });
      decodedBytes = g.len;
    }
    const rowRe = /<((?:\w+:)?)row\b([^>]*)>/g;
    rowRe.lastIndex = scanFrom;
    let m: RegExpExecArray | null;
    let prevStart = -1;
    while ((m = rowRe.exec(text))) {
      // Valores de la fila anterior: lo que hay entre su inicio y este.
      if (prevStart >= 0 && /<(?:\w+:)?(?:v|is)\b/.test(text.slice(prevStart, m.index))) lastValueRow = row;
      prefix = m[1]!;
      const r = /\br="(\d+)"/.exec(m[2]!);
      const rw = r ? Number(r[1]) : row + 1;
      if (lastValueRow >= 0 && rw - lastValueRow > gap) return new TextEncoder().encode(text.slice(0, m.index)).length;
      row = rw;
      prevStart = m.index;
      scanFrom = m.index;
    }
    if (text.includes(`</${prefix}sheetData>`, Math.max(0, scanFrom))) return "fin";
    return done ? "fin" : null;
  };
}

/** Escribe un zip nuevo: las entradas sin cambios se copian comprimidas tal cual; las compactadas, sin comprimir. */
function writeZip(src: Uint8Array, entries: Entry[], replaced: Map<string, Uint8Array>): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const repl = replaced.get(e.name);
    const data = repl ?? src.subarray(e.dataStart, e.dataStart + e.compSize);
    const method = repl ? 0 : e.method;
    const crc = repl ? crc32(repl) : e.crc;
    const size = repl ? repl.length : e.size;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // nombres en UTF-8
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const x of [...parts, ...central, end]) {
    out.set(x, p);
    p += x.length;
  }
  return out;
}

export interface Compaction {
  data: Uint8Array;
  /** Hojas recortadas, con su tamaño antes y después (descomprimidas). */
  sheets: { name: string; before: number; after: number }[];
}

/**
 * Si el libro (xlsx/xlsb) tiene hojas enormes por filas vacías al final, devuelve una copia
 * recortada; si no hace falta o no se puede, devuelve null y se usa el archivo tal cual.
 */
export async function compactWorkbook(buf: Uint8Array, opts: { gap?: number; minSheetBytes?: number } = {}): Promise<Compaction | null> {
  if (typeof DecompressionStream === "undefined") return null;
  const entries = readZip(buf);
  if (!entries) return null;
  const gap = opts.gap ?? EMPTY_GAP;
  const min = opts.minSheetBytes ?? MIN_SHEET_BYTES;
  const replaced = new Map<string, Uint8Array>();
  const sheets: Compaction["sheets"] = [];
  for (const e of entries) {
    const bin = /^xl\/worksheets\/[^/]+\.bin$/i.test(e.name);
    const xml = /^xl\/worksheets\/[^/]+\.xml$/i.test(e.name);
    if ((!bin && !xml) || e.method !== 8 || e.size < min) continue;
    const res = await inflateUntil(buf.subarray(e.dataStart, e.dataStart + e.compSize), bin ? xlsbScanner(gap) : xlsxScanner(gap));
    if (!res) continue;
    let sheet: Uint8Array;
    if (bin) {
      sheet = new Uint8Array(res.cut + XLSB_TAIL.length);
      sheet.set(res.data.buf.subarray(0, res.cut));
      sheet.set(XLSB_TAIL, res.cut);
    } else {
      const head = new TextDecoder().decode(res.data.buf.subarray(0, res.cut));
      const pre = /<(\w+:)?sheetData\b/.exec(head)?.[1] ?? "";
      const root = /<((?:\w+:)?)worksheet\b/.exec(head)?.[1] ?? "";
      sheet = new TextEncoder().encode(`${head}</${pre}sheetData></${root}worksheet>`);
    }
    replaced.set(e.name, sheet);
    sheets.push({ name: e.name, before: e.size, after: sheet.length });
  }
  if (!replaced.size) return null;
  return { data: writeZip(buf, entries, replaced), sheets };
}
