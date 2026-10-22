/* La lectura en dos pasos (primeras filas → solo las hojas necesarias, modo compacto) debe dar
   EXACTAMENTE lo mismo que leer el libro entero como antes. */
import { describe, expect, it } from "vitest";
import { XLSX, workbookBytes } from "../test/libros";
import { CAMPAIGNS } from "./campaigns";
import { WorkbookReader, detectDatasets, dominantMonth, normalizeRow, parseWorkbook } from "./importers";
import { chunkEnds, peekWorkbook, readDataset, type XLSXReader } from "./lectura";

const X = XLSX as unknown as XLSXReader;

function lecturaAnterior(bytes: Uint8Array, campaign: (typeof CAMPAIGNS)[number]["code"], datasetId: string) {
  const reader = new WorkbookReader(X, X.read(bytes, { type: "array", cellDates: false }));
  const detections = detectDatasets(reader, campaign);
  const res = parseWorkbook(reader, datasetId);
  if ("error" in res) throw new Error(res.error);
  const kind = CAMPAIGNS.find((c) => c.code === campaign)!.datasets.find((d) => d.id === datasetId)!.kind;
  return { detections, rows: res.rows.map((r) => normalizeRow(datasetId, kind, campaign, r)), dropped: res.dropped, sheet: res.sheet, month: dominantMonth(res.rows, datasetId) };
}

describe("lectura en dos pasos", () => {
  for (const c of CAMPAIGNS) {
    for (const ds of c.datasets) {
      it(`${ds.id}: mismo resultado que leer el libro entero`, () => {
        const bytes = workbookBytes(ds.id, { rowsPerSheet: 40, extraSheet: true });
        const before = lecturaAnterior(bytes, c.code, ds.id);
        const { reader, detections } = peekWorkbook(X, bytes, c.code);
        expect(detections).toEqual(before.detections);
        const r = readDataset(X, bytes, c.code, reader, detections, ds.id);
        expect(r.error).toBeNull();
        expect(r.rows).toEqual(before.rows);
        expect(r.dropped).toBe(before.dropped);
        expect(r.sheet).toBe(before.sheet);
        expect(r.month).toEqual(before.month);
        expect(r.chunkEnds.at(-1)).toBe(r.rows.length);
      });
    }
  }

  it("lee .xlsb igual que .xlsx", () => {
    const id = "tdc:base:primeras";
    const a = workbookBytes(id, { rowsPerSheet: 100, bookType: "xlsx" });
    const b = workbookBytes(id, { rowsPerSheet: 100, bookType: "xlsb" });
    const pa = peekWorkbook(X, a, "tdc");
    const pb = peekWorkbook(X, b, "tdc");
    expect(pb.detections[0]?.datasetId).toBe(id);
    expect(readDataset(X, b, "tdc", pb.reader, pb.detections, id).rows).toEqual(readDataset(X, a, "tdc", pa.reader, pa.detections, id).rows);
  });

  it("informa cuántas filas va a leer", () => {
    const id = "tdc:base:primeras";
    const bytes = workbookBytes(id, { rowsPerSheet: 250 });
    const { reader, detections } = peekWorkbook(X, bytes, "tdc");
    const steps: string[] = [];
    readDataset(X, bytes, "tdc", reader, detections, id, (s) => steps.push(s));
    expect(steps[0]).toMatch(/Leyendo 253 filas/);
  });

  it("archivo no reconocido o sin la hoja: mensaje claro", () => {
    const bytes = workbookBytes("tdc:sabana");
    const { reader, detections } = peekWorkbook(X, bytes, "upin");
    expect(readDataset(X, bytes, "upin", reader, detections, null).error).toMatch(/No reconocí/);
    const forced = readDataset(X, bytes, "upin", reader, detections, CAMPAIGNS.find((c) => c.code === "upin")!.datasets[0]!.id);
    expect(forced.error).toBeTruthy();
  });

  it("lotes de máximo 500 filas", () => {
    const rows = Array.from({ length: 1234 }, (_, i) => ({ niu: String(i), profile: null, offer: null, extra: {} }));
    expect(chunkEnds(rows)).toEqual([500, 1000, 1234]);
  });
});
