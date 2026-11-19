import { describe, expect, it } from "vitest";
import { grupoDocumentacion, toquesDespuesDeVenta } from "./seguimientoDoc";

describe("seguimiento de documentación", () => {
  it("agrupa por subetapa de la sábana TDC", () => {
    expect(grupoDocumentacion("PENDIENTE DOCUMENTO")).toBe("seguimiento");
    expect(grupoDocumentacion("PENDIENTE DOCUMENTO/VENCIDO")).toBeNull();
    expect(grupoDocumentacion("PENDIENTE POR REQUISITO/VENCIDOS")).toBeNull();
    expect(grupoDocumentacion("Pendiente documento / vencido")).toBeNull();
    expect(grupoDocumentacion("PENDIENTE POR REQUISITO")).toBe("seguimiento");
    expect(grupoDocumentacion("EXTRARREQUISITO")).toBe("seguimiento");
    expect(grupoDocumentacion("Extra requisito")).toBe("seguimiento");
    expect(grupoDocumentacion("EN PROCESO")).toBe("productivas");
    expect(grupoDocumentacion("EN DISTRIBUCIÓN")).toBe("productivas");
    expect(grupoDocumentacion("DEVOLUCION")).toBe("productivas");
    for (const s of ["ENTREGADA", "RECHAZADO", "CREACIÓN DE EMPRESA", "MH EN PROCESO", "CASO EN AUDITORIA", "PENDIENTE DE EVALUAR PCBM", "", null]) expect(grupoDocumentacion(s)).toBeNull();
  });

  it("cuenta llamadas y días de gestión desde el día siguiente a la venta", () => {
    const t = toquesDespuesDeVenta("2026-11-18", [
      { fecha: "2026-11-18T09:00:00", tipologia: "No contesta" }, // mismo día de la venta: no cuenta
      { fecha: "2026-11-19T09:00:00", tipologia: "No contesta" },
      { fecha: "2026-11-19T11:00:00", tipologia: "Buzon de voz" },
      { fecha: "2026-11-19T15:00:00", tipologia: "No contesta" },
      { fecha: "2026-11-21T10:00:00", tipologia: " Se realiza cita " },
      { fecha: null, tipologia: "Sin fecha" },
    ]);
    expect(t).toEqual({ llamadas: 4, dias: 2, ultima: "2026-11-21T10:00:00", tipificacion: "Se realiza cita" });
    expect(toquesDespuesDeVenta("2026-11-18", [])).toEqual({ llamadas: 0, dias: 0, ultima: null, tipificacion: null });
  });
});
