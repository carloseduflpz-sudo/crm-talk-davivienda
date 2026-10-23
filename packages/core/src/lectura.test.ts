/* La lectura en dos pasos (primeras filas → solo las hojas necesarias, modo compacto) debe dar
   EXACTAMENTE lo mismo que leer el libro entero como antes. */
import { describe, expect, it } from "vitest";
import { XLSX, workbookBytes } from "../test/libros";
import { CAMPAIGNS } from "./campaigns";
import { WorkbookReader, detectDatasets, dominantMonth, normalizeRow, parseWorkbook } from "./importers";
import { chunkEnds, onlyMonth, peekWorkbook, readDataset, rowMonth, rowsByMonth, type XLSXReader } from "./lectura";

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

  it("VICI histórico outbound: id_cliente y user_name; el marcador automático queda sin agente", () => {
    const head = ["uniqueid", "lead_id", "call_date", "status", "user", "user_name", "categoria", "tipologia", "subtipologia", "id_cliente"];
    const rows = [
      head,
      [1, 10, "2026-10-01 08:00:00", "A", "RA-1", "Agente Uno", "No contacto", "Buzon de voz", "Buzon de voz", 123456],
      [2, 11, "2026-10-01 08:05:00", "DROP", "VDAD", "Outbound Auto Dial", "Sin asignar a un agente", "Sin asignar a un agente", "Sin asignar a un agente", null],
      [3, 12, "2026-10-02 09:00:00", "SALE", "RA-2", "Agente Dos", "Contacto efectivo positivo", "Venta realizada", "Venta realizada", 654321],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const { reader, detections } = peekWorkbook(X, bytes, "tdc");
    expect(detections[0]?.datasetId).toBe("tdc:tipif");
    const r = readDataset(X, bytes, "tdc", reader, detections, "tdc:tipif");
    expect(r.error).toBeNull();
    expect(r.rows).toHaveLength(3); // la llamada sin NIU se conserva: cuenta para contactabilidad
    expect(r.rows.map((x) => [x.niu, (x as { agent: string | null }).agent])).toEqual([
      ["123456", "Agente Uno"],
      ["", null],
      ["654321", "Agente Dos"],
    ]);
    expect(r.month?.month).toBe("2026-10");
  });

  it("si faltan columnas, el mensaje dice exactamente cuáles", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["call_date", "categoria", "tipologia", "user_name"], ["2026-10-01 08:00:00", "No contacto", "Buzon de voz", "Uno"]]), "Sheet1");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const { reader, detections } = peekWorkbook(X, bytes, "tdc");
    expect(readDataset(X, bytes, "tdc", reader, detections, "tdc:tipif").error).toMatch(/faltan columnas obligatorias: id_base o id_cliente\./);
  });

  it("separa las filas por mes para no mezclar meses", () => {
    const sale = (niu: string, saleDate: string | null) => ({ niu, process: null, saleDate, executive: null, statusRaw: null, reason: null, daysInProcess: null, amount: null, extra: {} });
    const call = (niu: string, calledAt: string | null) => ({ niu, agent: null, calledAt, category: null, tipologia: null, extra: {} });
    const rows = [sale("1", "2026-10-02"), sale("2", "2026-09-30"), sale("3", null), sale("4", "2026-10-21")];
    expect(rowsByMonth(rows)).toEqual({ byMonth: { "2026-10": 2, "2026-09": 1 }, sinFecha: 1 });
    expect(onlyMonth(rows, "2026-10").map((r) => r.niu)).toEqual(["1", "3", "4"]);
    expect(rowMonth(call("5", "2026-09-01 08:00:00"))).toBe("2026-09");
    expect(rowMonth({ niu: "6", profile: null, offer: null, extra: {} })).toBeNull();
  });
});

describe("TDC: base de primeras vs. segundas cuentas", () => {
  const SEG = ["NIU", "DUI", "Nombre legal según IBS", "Nombre empresa", "Cargo", "Municipio", "Departamento", "TelNotificaciones", "Tipo empresa", "Perfil", "Tipo", "Marca", "Salario a Considerar", "Edad", "Perfil SS", "Condicion", "Aplica CDC", "Tipo CDC", "BASE", "ASIGNACION"];
  const PRI = ["NIU", "DUI", "Municipio", "Departamento", "Correo", "TEL Notificaciones", "Producto Principal", "Oferta", "Monto2", "Plazo (meses)", "Tasa2", "Cuota", "Limite", "Score Tc", "Edad", "Genero", "Marca", "Tipo", "CANAL", "Estrategia", "Nombre legal según IBS", "PERFIL"];
  const book = (sheets: [string, string[], string?][]) => {
    const wb = XLSX.utils.book_new();
    for (const [name, headers, niu = "123"] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, headers.map((h, i) => (i === 0 ? niu : `${h} 1`))]), name);
    return new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
  };
  const top = (bytes: Uint8Array, fileName = "") => peekWorkbook(X, bytes, "tdc", fileName).detections[0]?.datasetId;

  it("las reconoce por sus columnas, aunque la hoja tenga otro nombre", () => {
    expect(top(book([["Hoja1", SEG]]))).toBe("tdc:base:segundas");
    expect(top(book([["Hoja1", PRI]]))).toBe("tdc:base:primeras");
    // Pocas columnas exclusivas bastan.
    expect(top(book([["Sheet1", ["NIU", "Nombre legal según IBS", "Perfil", "Tipo", "Salario a Considerar", "Aplica CDC"]]]))).toBe("tdc:base:segundas");
    expect(top(book([["Sheet1", ["NIU", "Nombre legal según IBS", "Perfil", "Tipo", "Oferta", "Score Tc"]]]))).toBe("tdc:base:primeras");
  });

  it("con las mismas columnas, el nombre del archivo decide", () => {
    const comun = book([["Sheet1", ["NIU", "DUI", "Nombre legal según IBS", "Perfil", "Tipo", "Marca", "Edad"]]]);
    expect(top(comun, "Base 2a TDC Octubre.xlsx")).toBe("tdc:base:segundas");
    expect(top(comun, "BASE_2DA_TDC_SEP.xlsb")).toBe("tdc:base:segundas");
    expect(top(comun, "Base BAU Oct26.xlsx")).toBe("tdc:base:primeras");
    expect(top(comun, "Primeras cuentas septiembre.xlsx")).toBe("tdc:base:primeras");
  });

  it("Primeras Cuentas en formato entregable del banco (NIUCliente, NombreSociedad...) y sin PERFIL", () => {
    const ENT = ["NIUCliente", "NombreSociedad", "NumeroDUI", "Municipio", "Departamento", "Correo", "TelNotificaciones", "Límite", "Tipo Tarjeta", "Clasificación Riesgo"];
    const bytes = book([["Entregable", ENT, "4455"]]);
    expect(top(bytes)).toBe("tdc:base:primeras");
    const { reader, detections } = peekWorkbook(X, bytes, "tdc");
    const r = readDataset(X, bytes, "tdc", reader, detections, "tdc:base:primeras");
    expect(r.error).toBeNull();
    expect(r.rows[0]).toMatchObject({ niu: "4455", profile: null });
    expect(r.rows[0]!.extra).toMatchObject({ Nombre: "NombreSociedad 1", DUI: "NumeroDUI 1", "TEL Notificaciones": "TelNotificaciones 1" });
  });

  it("una base repartida en varias hojas se lee completa (sin mezclar la otra base)", () => {
    const bytes = book([
      ["Asalariados", PRI, "111"],
      ["Independientes", PRI, "112"],
      ["Resumen", ["Segmento", "Total"]],
      ["2a TDC", SEG, "222"],
    ]);
    const { reader, detections } = peekWorkbook(X, bytes, "tdc");
    const pri = readDataset(X, bytes, "tdc", reader, detections, "tdc:base:primeras");
    expect(pri.rows.map((r) => r.niu)).toEqual(["111", "112"]);
    expect(pri.sheet).toBe("Asalariados + Independientes");
    expect(readDataset(X, bytes, "tdc", reader, detections, "tdc:base:segundas").rows.map((r) => r.niu)).toEqual(["222"]);
  });

  it("primeras y segundas con LAS MISMAS columnas en hojas distintas: el nombre de la hoja las separa", () => {
    const ENT = ["NIUCliente", "NombreSociedad", "NumeroDUI", "Municipio", "Departamento", "TelNotificaciones", "Límite", "PERFIL"];
    const bytes = book([
      ["Primeras Cuentas", ENT, "111"],
      ["Segundas Cuentas", ENT, "222"],
    ]);
    const { reader, detections } = peekWorkbook(X, bytes, "tdc");
    const pri = readDataset(X, bytes, "tdc", reader, detections, "tdc:base:primeras");
    expect(pri.rows.map((r) => r.niu)).toEqual(["111"]);
    expect(readDataset(X, bytes, "tdc", reader, detections, "tdc:base:segundas").rows.map((r) => r.niu)).toEqual(["222"]);
    expect(pri.hojas).toEqual([
      { name: "Primeras Cuentas", rows: 2, tipos: ["tdc:base:primeras"] },
      { name: "Segundas Cuentas", rows: 2, tipos: ["tdc:base:segundas"] },
    ]);
  });

  it("una hoja con otras columnas nunca se suma a la base", () => {
    const bytes = book([
      ["Base", PRI, "111"],
      ["Otra", ["NIU", "Perfil", "Municipio", "Departamento", "Observaciones"], "999"],
    ]);
    const { reader, detections } = peekWorkbook(X, bytes, "tdc");
    expect(readDataset(X, bytes, "tdc", reader, detections, "tdc:base:primeras").rows.map((r) => r.niu)).toEqual(["111"]);
  });

  it("una hoja consolidada y otras con partes de ella (cargas): se usa la consolidada y se anota la carga", () => {
    const wb = XLSX.utils.book_new();
    const sheet = (nius: string[]) => XLSX.utils.aoa_to_sheet([PRI, ...nius.map((n) => PRI.map((h, i) => (i === 0 ? n : `${h} ${n}`)))]);
    XLSX.utils.book_append_sheet(wb, sheet(["1", "2"]), "EMPRESA 1");
    XLSX.utils.book_append_sheet(wb, sheet(["3", "4", "5"]), "CARGA 3");
    XLSX.utils.book_append_sheet(wb, sheet(["1", "2", "3", "4", "5", "6"]), "Tarjeta Nueva");
    const bytes = new Uint8Array(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    const { reader, detections } = peekWorkbook(X, bytes, "tdc");
    const r = readDataset(X, bytes, "tdc", reader, detections, "tdc:base:primeras");
    expect(r.rows.map((x) => x.niu)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(r.sheet).toBe("Tarjeta Nueva");
    expect(r.covered).toEqual(["EMPRESA 1", "CARGA 3"]);
    expect(r.rows.map((x) => (x.extra as Record<string, unknown>).Cargas ?? null)).toEqual(["EMPRESA 1", "EMPRESA 1", "CARGA 3", "CARGA 3", "CARGA 3", null]);
  });

  it("si no se reconoce, el mensaje dice qué encabezados trae el archivo", () => {
    const bytes = book([["Datos", ["Cliente", "Telefono", "Monto"]]]);
    const { reader, detections } = peekWorkbook(X, bytes, "tdc");
    expect(readDataset(X, bytes, "tdc", reader, detections, null).error).toContain('Hoja "Datos": Cliente, Telefono, Monto');
  });

  it("un libro con las dos bases: cada tipo lee su propia hoja", () => {
    const bytes = book([
      ["Segundas", SEG, "222"],
      ["Primeras", PRI, "111"],
    ]);
    const { reader, detections } = peekWorkbook(X, bytes, "tdc");
    expect(detections.find((d) => d.datasetId === "tdc:base:primeras")?.sheet).toBe("Primeras");
    expect(detections.find((d) => d.datasetId === "tdc:base:segundas")?.sheet).toBe("Segundas");
    expect(readDataset(X, bytes, "tdc", reader, detections, "tdc:base:primeras").rows.map((r) => r.niu)).toEqual(["111"]);
    expect(readDataset(X, bytes, "tdc", reader, detections, "tdc:base:segundas").rows.map((r) => r.niu)).toEqual(["222"]);
  });
});

