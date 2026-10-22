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
  neededSheets,
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
}

export type Step = (message: string) => void;

const fmt = new Intl.NumberFormat("es-SV");

/** Primer paso: libro con sus primeras filas y los tipos de archivo que coinciden. */
export function peekWorkbook(XLSX: XLSXReader, data: Uint8Array, campaign: CampaignCode) {
  const wb = XLSX.read(data, { ...LEAN, sheetRows: PEEK_ROWS });
  const reader = new WorkbookReader(XLSX, wb);
  return { reader, detections: detectDatasets(reader, campaign) };
}

/** Cuántas filas tiene de verdad una hoja abierta parcialmente (SheetJS guarda el rango completo en !fullref). */
function totalRows(wb: WorkBookLike, sheet: string): number | null {
  const ws = wb.Sheets[sheet] as Record<string, unknown> | undefined;
  // Sin !fullref la hoja cupo completa en la lectura parcial (o SheetJS no lo informó): no se adivina.
  const ref = ws?.["!fullref"] as string | undefined;
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

/** Segundo paso: lee completo lo que necesita `datasetId` y deja las filas listas para guardar. */
export function readDataset(XLSX: XLSXReader, data: Uint8Array, campaign: CampaignCode, peek: WorkbookReader, detections: Detection[], datasetId: string | null, step: Step = () => {}): ExcelReading {
  const base: ExcelReading = { sheetNames: peek.sheetNames, detections, datasetId, error: null, rows: [], chunkEnds: [], dropped: 0, sheet: "", missingOptional: [], month: null };
  if (!datasetId) {
    return { ...base, error: `No reconocí este archivo como ninguno de los de ${getCampaign(campaign).shortName}. Revisa que sea el archivo correcto o elige el tipo a mano.` };
  }
  const sheets = neededSheets(peek, datasetId);
  // Sin hojas que leer: el lector da el mensaje exacto de qué falta.
  if (!sheets.length) {
    const res = parseWorkbook(peek, datasetId);
    return { ...base, error: "error" in res ? res.error : "No encontré la hoja con los datos." };
  }
  const total = sheets.reduce((s, sn) => s + (totalRows(peek.wb, sn) ?? 0), 0);
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
