/* Lectura completa de un Excel en dos pasos, pensada para archivos grandes (bases de 100 000+ filas):
   1. Se abre el libro SOLO con sus primeras filas para reconocer el tipo de archivo.
   2. Se lee completa únicamente la hoja (o las hojas) que ese tipo necesita, en modo compacto
      (sin textos con formato ni estilos), que usa la mitad de memoria y es ~3 veces más rápido.
   El resultado es idéntico al de leer el libro entero; solo cambia cuánto cuesta.
   Corre dentro de un Web Worker, para que la pantalla nunca se congele. */
import { getCampaign, type CampaignCode, type UploadKind } from "./campaigns";
import {
  WorkbookReader,
  detectDatasets,
  dominantMonth,
  headerPreview,
  neededSheets,
  sheetAssignments,
  normalizeRow,
  parseWorkbook,
  type Detection,
  type NormalizedRow,
  type WorkBookLike,
  type XLSXLike,
} from "./importers";

export type XLSXReader = XLSXLike & { read(data: ArrayBuffer | Uint8Array, opts: Record<string, unknown>): WorkBookLike };

/** Opciones de lectura compacta: solo valores crudos (los mismos que usa el lector). */
const LEAN = { type: "array", cellDates: false, cellText: false, cellNF: false, cellHTML: false, cellStyles: false, cellFormula: false, dense: true } as const;
/** Filas que bastan para encontrar los encabezados (se buscan en las 15 primeras no vacías). */
const PEEK_ROWS = 60;

/* Lotes de envío al servidor: hasta 500 filas y ~700 KB cada uno. */
const MAX_CHUNK_ROWS = 500;
const MAX_CHUNK_CHARS = 700_000;

export interface ExcelReading {
  sheetNames: string[];
  detections: Detection[];
  datasetId: string | null;
  error: string | null;
  rows: NormalizedRow[];
  /** Fin (exclusivo) de cada lote de envío dentro de `rows`. */
  chunkEnds: number[];
  dropped: number;
  sheet: string;
  missingOptional: string[];
  month: { month: string; share: number; byMonth: Record<string, number> } | null;
  /** Cada hoja del libro: cuántas filas tiene (si se sabe) y a qué tipo(s) de archivo va. */
  hojas: { name: string; rows: number | null; tipos: string[] }[];
}

export type Step = (message: string) => void;

const fmt = new Intl.NumberFormat("es-SV");

/** Primer paso: libro con sus primeras filas y los tipos de archivo que coinciden. */
export function peekWorkbook(XLSX: XLSXReader, data: Uint8Array, campaign: CampaignCode, fileName = "") {
  const wb = XLSX.read(data, { ...LEAN, sheetRows: PEEK_ROWS });
  const reader = new WorkbookReader(XLSX, wb);
  return { reader, detections: detectDatasets(reader, campaign, fileName) };
}

/** Cuántas filas tiene de verdad una hoja abierta parcialmente (SheetJS guarda el rango completo en !fullref). */
function totalRows(wb: WorkBookLike, sheet: string): number | null {
  const ws = wb.Sheets[sheet] as Record<string, unknown> | undefined;
  // Sin !fullref la hoja cupo completa en la lectura parcial (o SheetJS no lo informó): no se adivina.
  const ref = ws?.["!fullref"] as string | undefined;
  const m = ref?.match(/^[A-Z]+(\d+)(?::[A-Z]+(\d+))?$/i);
  return m ? Number(m[2] ?? m[1]) - Number(m[1]) + 1 : null;
}

/** Filas de una hoja para mostrarlas: el rango completo si se leyó en parte, o el rango leído si cupo entera. */
function sheetRowCount(wb: WorkBookLike, sheet: string): number | null {
  const full = totalRows(wb, sheet);
  if (full !== null) return full;
  const ref = (wb.Sheets[sheet] as Record<string, unknown> | undefined)?.["!ref"] as string | undefined;
  const m = ref?.match(/^[A-Z]+(\d+)(?::[A-Z]+(\d+))?$/i);
  return m ? Number(m[2] ?? m[1]) - Number(m[1]) + 1 : null;
}

export function chunkEnds(rows: NormalizedRow[]): number[] {
  const ends: number[] = [];
  let count = 0;
  let chars = 0;
  for (let i = 0; i < rows.length; i++) {
    const size = JSON.stringify(rows[i]).length + 1;
    if (count && (count >= MAX_CHUNK_ROWS || chars + size > MAX_CHUNK_CHARS)) {
      ends.push(i);
      count = 0;
      chars = 0;
    }
    count++;
    chars += size;
  }
  if (count) ends.push(rows.length);
  return ends;
}

/* ---------- meses de las filas: para no mezclar un mes con otro ---------- */

/** Mes (AAAA-MM) de una fila según su fecha: venta, llamada o ingreso. Las bases no traen fecha → null. */
export function rowMonth(r: NormalizedRow): string | null {
  const d = "saleDate" in r ? r.saleDate : "calledAt" in r ? r.calledAt : "enteredAt" in r ? r.enteredAt : null;
  const m = d ? /^(20\d{2})-(0[1-9]|1[0-2])/.exec(d) : null;
  return m ? `${m[1]}-${m[2]}` : null;
}

/** Cuántas filas trae el archivo de cada mes, y cuántas no tienen fecha. */
export function rowsByMonth(rows: readonly NormalizedRow[]): { byMonth: Record<string, number>; sinFecha: number } {
  const byMonth: Record<string, number> = {};
  let sinFecha = 0;
  for (const r of rows) {
    const m = rowMonth(r);
    if (m) byMonth[m] = (byMonth[m] ?? 0) + 1;
    else sinFecha++;
  }
  return { byMonth, sinFecha };
}

/** Solo las filas de `month` (las que no traen fecha se quedan: no hay cómo saber de qué mes son). */
export function onlyMonth<T extends NormalizedRow>(rows: readonly T[], month: string): T[] {
  return rows.filter((r) => {
    const m = rowMonth(r);
    return m === null || m === month;
  });
}

/** Segundo paso: lee completo lo que necesita `datasetId` y deja las filas listas para guardar. */
export function readDataset(
  XLSX: XLSXReader,
  data: Uint8Array,
  campaign: CampaignCode,
  peek: WorkbookReader,
  detections: Detection[],
  datasetId: string | null,
  step: Step = () => {},
  /** false cuando el libro se compactó: el rango declarado de la hoja ya no dice cuántas filas hay. */
  countRows = true,
): ExcelReading {
  const assigned = sheetAssignments(peek, detections);
  const hojas = peek.sheetNames.map((name) => ({ name, rows: countRows ? sheetRowCount(peek.wb, name) : null, tipos: assigned[name] ?? [] }));
  const base: ExcelReading = { sheetNames: peek.sheetNames, detections, datasetId, error: null, rows: [], chunkEnds: [], dropped: 0, sheet: "", missingOptional: [], month: null, hojas };
  if (!datasetId) {
    return {
      ...base,
      error: `No reconocí este archivo como ninguno de los de ${getCampaign(campaign).shortName}. Elige el tipo a mano arriba; si aun así no se lee, comparte estos encabezados para ajustarlo. ${headerPreview(peek)}`,
    };
  }
  const sheets = neededSheets(peek, datasetId);
  // Sin hojas que leer: el lector da el mensaje exacto de qué falta.
  if (!sheets.length) {
    const res = parseWorkbook(peek, datasetId);
    return { ...base, error: "error" in res ? res.error : "No encontré la hoja con los datos." };
  }
  const total = countRows ? sheets.reduce((s, sn) => s + (totalRows(peek.wb, sn) ?? 0), 0) : 0;
  step(total ? `Leyendo ${fmt.format(total)} filas de ${sheets.length > 1 ? "las hojas" : "la hoja"} ${sheets.join(" y ")}…` : "Leyendo las filas…");

  const wb = XLSX.read(data, { ...LEAN, sheets });
  const reader = new WorkbookReader(XLSX, wb);
  const res = parseWorkbook(reader, datasetId);
  if ("error" in res) return { ...base, error: res.error };
  // Las celdas ya se convirtieron en filas: se sueltan para liberar memoria.
  for (const sn of sheets) delete wb.Sheets[sn];

  step(`Validando ${fmt.format(res.rows.length)} filas…`);
  const kind = getCampaign(campaign).datasets.find((d) => d.id === datasetId)!.kind as UploadKind;
  const rows = res.rows.map((r) => normalizeRow(datasetId, kind, campaign, r));
  return {
    ...base,
    error: rows.length ? null : "El archivo no tiene filas válidas: todas están vacías o sin NIU.",
    rows,
    chunkEnds: chunkEnds(rows),
    dropped: res.dropped,
    sheet: res.sheet,
    missingOptional: res.missingOptional,
    month: dominantMonth(res.rows, datasetId),
  };
}
