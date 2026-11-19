/* Excel (.xlsx) con formato: colores de encabezado, bordes, letra, anchos de columna y fechas.
   El SheetJS que usa la app no guarda estilos, así que el libro se arma directo (XML + ZIP sin comprimir). */

export type ValorCelda = string | number | null | undefined;

export interface ColumnaEstilo {
  titulo: string;
  /** Ancho como en Excel (caracteres). */
  ancho: number;
  /** Color de relleno del encabezado (RGB sin #, p. ej. "C00000"). */
  relleno: string;
  /** Color de la letra del encabezado (RGB sin #). */
  letra?: string;
  negrita?: boolean;
  /** Tamaño de la letra del encabezado (si no, el de la hoja). */
  tamano?: number;
  /** "fecha": el valor es AAAA-MM-DD y se guarda como fecha de Excel; "numero": número. */
  tipo?: "texto" | "numero" | "fecha";
  alinear?: "left" | "center" | "right";
}

export interface HojaEstilo {
  nombre: string;
  columnas: ColumnaEstilo[];
  filas: ValorCelda[][];
  /** Letra de toda la hoja. */
  fuente?: { nombre: string; tamano: number };
  zoom?: number;
}

const esc = (s: string) =>
  s
    // Caracteres de control que Excel no acepta dentro del XML.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function colLetra(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** AAAA-MM-DD → número de serie de Excel (días desde 1899-12-30). */
export function serialExcel(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  return Math.round((Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** Registro de estilos: cada combinación (letra, relleno, alineación, formato) se guarda una sola vez. */
class Estilos {
  fonts = ['<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>'];
  fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private idx = new Map<string, number>();
  private add(list: string[], xml: string): number {
    const k = `${list === this.fonts ? "f" : list === this.fills ? "p" : "x"}:${xml}`;
    let i = this.idx.get(k);
    if (i === undefined) {
      i = list.push(xml) - 1;
      this.idx.set(k, i);
    }
    return i;
  }
  xf(o: { fuente: string; tamano: number; negrita?: boolean; letra?: string; relleno?: string; alinear?: string; fecha?: boolean }): number {
    const font = this.add(
      this.fonts,
      `<font>${o.negrita ? "<b/>" : ""}<sz val="${o.tamano}"/>${o.letra ? `<color rgb="FF${o.letra}"/>` : ""}<name val="${esc(o.fuente)}"/><family val="2"/></font>`,
    );
    const fill = o.relleno ? this.add(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="FF${o.relleno}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    const align = `<alignment horizontal="${o.alinear ?? "left"}" vertical="center"/>`;
    return this.add(
      this.xfs,
      `<xf numFmtId="${o.fecha ? 164 : 0}" fontId="${font}" fillId="${fill}" borderId="1" xfId="0" applyFont="1" applyFill="${fill ? 1 : 0}" applyBorder="1" applyAlignment="1"${o.fecha ? ' applyNumberFormat="1"' : ""}>${align}</xf>`,
    );
  }
  xml(): string {
    const thin = '<left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/>';
    return (
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<numFmts count="1"><numFmt numFmtId="164" formatCode="dd/mm/yyyy"/></numFmts>` +
      `<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>` +
      `<fills count="${this.fills.length}">${this.fills.join("")}</fills>` +
      `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${thin}</border></borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>` +
      `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`
    );
  }
}

function hojaXml(h: HojaEstilo, est: Estilos): string {
  const fuente = h.fuente ?? { nombre: "Calibri Light", tamano: 11 };
  const enc = h.columnas.map((c) =>
    est.xf({ fuente: fuente.nombre, tamano: c.tamano ?? fuente.tamano, negrita: c.negrita, letra: c.letra, relleno: c.relleno, alinear: "center" }),
  );
  const dat = h.columnas.map((c) => est.xf({ fuente: fuente.nombre, tamano: fuente.tamano, alinear: c.alinear ?? "left", fecha: c.tipo === "fecha" }));
  const celda = (v: ValorCelda, r: number, i: number, s: number, tipo?: ColumnaEstilo["tipo"]) => {
    const ref = `${colLetra(i)}${r}`;
    if (v === null || v === undefined || v === "") return `<c r="${ref}" s="${s}"/>`;
    if (tipo === "fecha" && typeof v === "string") {
      const n = serialExcel(v);
      if (n !== null) return `<c r="${ref}" s="${s}"><v>${n}</v></c>`;
    }
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    if (tipo === "numero" && /^-?\d+(\.\d+)?$/.test(String(v)) && String(v).length < 16) return `<c r="${ref}" s="${s}"><v>${v}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(String(v))}</t></is></c>`;
  };
  const filas = [
    `<row r="1">${h.columnas.map((c, i) => celda(c.titulo, 1, i, enc[i]!)).join("")}</row>`,
    ...h.filas.map((f, j) => `<row r="${j + 2}">${h.columnas.map((c, i) => celda(f[i], j + 2, i, dat[i]!, c.tipo)).join("")}</row>`),
  ];
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheetViews><sheetView workbookViewId="0"${h.zoom ? ` zoomScale="${h.zoom}" zoomScaleNormal="${h.zoom}"` : ""}/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${h.columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho}" customWidth="1"/>`).join("")}</cols>` +
    `<sheetData>${filas.join("")}</sheetData>` +
    `<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`
  );
}

/* ---------- ZIP sin comprimir ---------- */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(d: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    lh.set(name, 30);
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    ch.set(name, 46);
    locals.push(lh, f.data);
    centrals.push(ch);
    offset += lh.length + f.data.length;
  }
  const cdSize = centrals.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + cdSize + 22);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/** Libro .xlsx con los estilos de cada hoja. */
export function libroConEstilos(hojas: HojaEstilo[]): Uint8Array {
  const enc = new TextEncoder();
  const est = new Estilos();
  const nombres = hojas.map((h, i) => esc(h.nombre.slice(0, 31).replace(/[\\/?*[\]:]/g, " ")) || `Hoja${i + 1}`);
  const sheets = hojas.map((h) => hojaXml(h, est));
  const x = (s: string) => enc.encode(s);
  return zip([
    {
      name: "[Content_Types].xml",
      data: x(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
          .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
          .join("")}</Types>`,
      ),
    },
    {
      name: "_rels/.rels",
      data: x(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: "xl/workbook.xml",
      data: x(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${nombres
          .map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("")}</sheets></workbook>`,
      ),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: x(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
          .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
          .join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    { name: "xl/styles.xml", data: x(est.xml()) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x(s) })),
  ]);
}
