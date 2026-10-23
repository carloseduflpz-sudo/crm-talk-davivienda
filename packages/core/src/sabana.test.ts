import { describe, expect, it } from "vitest";
import { compareSabanas, summarizeSales } from "./sabana";

const sale = (niu: string, saleDate: string | null, process: string | null = null) => ({ niu, process, saleDate, executive: null, statusRaw: null, reason: null, daysInProcess: null, amount: null, extra: {} });

describe("sábanas incompletas", () => {
  const vigente = summarizeSales([sale("1", "2026-10-01", "BASE"), sale("2", "2026-10-20", "BASE"), sale("3", "2026-10-21", "ONLINE"), sale("4", "2026-09-30", "BASE")], "2026-10");

  it("resume filas, hasta qué día llega, por mes y por proceso", () => {
    expect(vigente).toEqual({ filas: 4, hasta: "2026-10-21", porMes: { "2026-10": 3, "2026-09": 1 }, porProceso: { BASE: 3, ONLINE: 1 } });
  });

  it("una nueva que trae menos (sin un proceso, a un día anterior, sin la cosecha) se marca", () => {
    const nueva = summarizeSales([sale("1", "2026-10-01", "BASE"), sale("2", "2026-10-20", "BASE")], "2026-10");
    const d = compareSabanas(vigente, nueva, "2026-10");
    expect(d.menos).toBe(true);
    expect(d.puntos.filter((p) => p.menos).map((p) => p.que)).toEqual(["Ventas en la sábana", "Llega hasta", "Vendidas en el mes", "Cosecha de 2026-09", "Proceso BASE", "Proceso ONLINE"]);
  });

  it("una nueva que trae lo mismo y más no se marca", () => {
    const nueva = summarizeSales([sale("1", "2026-10-01", "BASE"), sale("2", "2026-10-20", "BASE"), sale("3", "2026-10-21", "ONLINE"), sale("4", "2026-09-30", "BASE"), sale("5", "2026-10-22", "BASE")], "2026-10");
    const d = compareSabanas(vigente, nueva, "2026-10");
    expect(d.menos).toBe(false);
    expect(d.puntos.find((p) => p.que === "Llega hasta")).toMatchObject({ antes: "2026-10-21", ahora: "2026-10-22", menos: false });
  });
});
