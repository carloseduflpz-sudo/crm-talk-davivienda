/* Los 27 tipos de archivo (6 campañas × sábana, bases, VICI, CRM) con libros de Excel
   generados con datos INVENTADOS: se escriben como .xlsx real y se vuelven a leer. */
import { describe, expect, it } from "vitest";
import { XLSX, workbookFor } from "../test/libros";
import { ALL_DATASETS, type CampaignCode, type UploadKind } from "./campaigns";
import { PROFILES, WorkbookReader, detectDatasets, dominantMonth, normalizeRow, parseWorkbook } from "./importers";

describe("lectores de Excel: los 27 tipos de archivo", () => {
  for (const ds of ALL_DATASETS) {
    it(`${ds.id} se lee, se reconoce y se normaliza`, () => {
      const reader = workbookFor(ds.id);
      const res = parseWorkbook(reader, ds.id);
      if ("error" in res) throw new Error(res.error);
      const parts = PROFILES[ds.id]!.multiSheet?.length ?? 1;
      const isVici = ds.kind === "tipif";
      // VICI conserva llamadas sin NIU; los demás descartan esa fila.
      expect(res.rows.length).toBe(isVici ? 4 * parts : 3 * parts);
      expect(res.dropped).toBe(isVici ? 0 : parts);

      // El tipo de archivo se reconoce solo, como primera opción.
      const detected = detectDatasets(reader, ds.campaign);
      expect(detected[0]?.datasetId, `${ds.id} se reconoció como ${detected.map((d) => d.datasetId).join(", ")}`).toBe(ds.id);

      const row = normalizeRow(ds.id, ds.kind as UploadKind, ds.campaign as CampaignCode, res.rows[0]!) as unknown as Record<string, unknown>;
      expect(row.niu === "12340" || (isVici && typeof row.niu === "string")).toBe(true);
      if (ds.kind === "sabana") {
        expect(typeof row.statusRaw).toBe("string");
        expect(String(row.saleDate)).toMatch(/^2026-09-\d{2}$/);
        expect(typeof row.executive).toBe("string");
      }
      if (ds.kind === "tipif") {
        expect(row.calledAt).toBe("2026-09-10T10:10:00");
        expect(row.tipologia).toBe("Venta realizada");
      }

      const dm = dominantMonth(res.rows, ds.id);
      if (PROFILES[ds.id]!.monthField) expect(dm?.month).toBe("2026-09");
    });
  }
});

describe("reglas de lectura", () => {
  it("dice qué encabezado obligatorio falta", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["NIU", "VENTA", "EJECUTIVO"], ["1", "01/09/2026", "Ana"]]), "CONSOLIDADO DE VENTAS");
    const res = parseWorkbook(new WorkbookReader(XLSX, wb as never), "tdc:sabana");
    expect("error" in res && res.error.includes("SUBETAPA")).toBe(true);
  });

  it("un archivo de otra cosa no se reconoce como nada", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Producto", "Precio"], ["Café", 2]]), "Hoja1");
    expect(detectDatasets(new WorkbookReader(XLSX, wb as never), "tdc")).toEqual([]);
  });

  it("normaliza NIU con ceros, decimales y notación científica", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([["NIU", "Colectores que paga"], ["000123", "A"], [456.0, "B"], ["7.89e+3", "C"], ["NULL", "D"]]),
      "Domiciliaciones",
    );
    const res = parseWorkbook(new WorkbookReader(XLSX, wb as never), "domi:base:domi");
    if ("error" in res) throw new Error(res.error);
    expect(res.rows.map((r) => r.NIU)).toEqual(["123", "456", "7890"]);
    expect(res.dropped).toBe(1);
  });

  it("las fechas del banco son día/mes", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["NIU", "VENTA", "SUBETAPA", "EJECUTIVO"], ["1", "05/06/2026", "ENTREGADA", "Ana"]]), "CONSOLIDADO DE VENTAS");
    const res = parseWorkbook(new WorkbookReader(XLSX, wb as never), "tdc:sabana");
    if ("error" in res) throw new Error(res.error);
    const row = normalizeRow("tdc:sabana", "sabana", "tdc", res.rows[0]!) as { saleDate: string };
    expect(row.saleDate).toBe("2026-06-05");
  });
});
