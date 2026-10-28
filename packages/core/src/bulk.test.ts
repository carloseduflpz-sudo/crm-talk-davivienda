import { describe, expect, it } from "vitest";
import { mesDeSabana, planBases, planBulk, planSabanas } from "./bulk";

describe("carga histórica: reparto por campaña y mes", () => {
  const files = [
    { index: 0, campaign: "tdc" as const, byMonth: { "2026-01": 100, "2026-02": 5 } }, // trae unas llamadas del mes siguiente
    { index: 1, campaign: "tdc" as const, byMonth: { "2026-02": 90 } },
    { index: 2, campaign: "cdc" as const, byMonth: { "2026-01": 40 } },
  ];

  it("junta lo de cada campaña × mes aunque venga en varios archivos", () => {
    const plan = planBulk(files, new Set(), false);
    expect(plan.map((u) => [u.campaign, u.month, u.rows, u.files, u.upload])).toEqual([
      ["tdc", "2026-01", 100, [0], true],
      ["tdc", "2026-02", 95, [0, 1], true],
      ["cdc", "2026-01", 40, [2], true],
    ]);
  });

  it("los meses ya cargados se saltan, salvo que se pida reemplazarlos", () => {
    const existing = new Set(["tdc|2026-02"]);
    expect(planBulk(files, existing, false).find((u) => u.month === "2026-02")).toMatchObject({ exists: true, upload: false });
    expect(planBulk(files, existing, true).find((u) => u.month === "2026-02")).toMatchObject({ exists: true, upload: true });
  });
});

describe("carga masiva de sábanas", () => {
  it("el mes de una sábana es el más reciente con ventas de verdad (la cosecha y una fecha mal escrita no lo cambian)", () => {
    expect(mesDeSabana({ "2026-08": 300, "2026-09": 250, "2026-10": 400, "2026-11": 2 })).toBe("2026-10");
    expect(mesDeSabana({ "2026-09": 50 })).toBe("2026-09");
    expect(mesDeSabana({})).toBe(null);
  });

  it("una carga por archivo; dos archivos del mismo mes quedan en conflicto y no se guarda ninguno", () => {
    const plan = planSabanas(
      [
        { index: 0, campaign: "tdc", month: "2026-09", rows: 900 },
        { index: 1, campaign: "tdc", month: "2026-10", rows: 1000 },
        { index: 2, campaign: "tdc", month: "2026-10", rows: 1100 },
        { index: 3, campaign: "domi", month: "2026-10", rows: 400 },
      ],
      new Set(["domi|2026-10"]),
      false,
    );
    expect(plan.map((u) => [u.campaign, u.month, u.files, u.conflicto, u.upload])).toEqual([
      ["tdc", "2026-09", [0], false, true],
      ["tdc", "2026-10", [1, 2], true, false],
      ["domi", "2026-10", [3], false, false],
    ]);
  });
});

describe("carga masiva de bases", () => {
  const files = [
    { index: 0, campaign: "tdc" as const, dataset: "tdc:base:primeras", month: "2026-10", rows: 5000 },
    { index: 1, campaign: "tdc" as const, dataset: "tdc:base:segundas", month: "2026-10", rows: 5400 },
    { index: 2, campaign: "tdc" as const, dataset: "tdc:base:primeras", month: "2026-10", rows: 300 }, // el banco mandó más
    { index: 3, campaign: "domi" as const, dataset: "domi:base:domi", month: "2026-09", rows: 6000 },
  ];
  const existing = new Set(["domi:base:domi|2026-09"]);

  it("el primer archivo de cada base y mes es la base; los demás se suman como adicionales", () => {
    const plan = planBases(files, existing, "saltar");
    expect(plan.map((u) => [u.dataset, u.month, u.files[0], u.modo ?? null, u.upload])).toEqual([
      ["tdc:base:primeras", "2026-10", 0, "nueva", true],
      ["tdc:base:primeras", "2026-10", 2, "adicional", true],
      ["tdc:base:segundas", "2026-10", 1, "nueva", true],
      ["domi:base:domi", "2026-09", 3, null, false],
    ]);
  });

  it("si el mes ya tiene base: se salta, se reemplaza o se suma como adicional, según se elija", () => {
    expect(planBases(files, existing, "reemplazar").find((u) => u.dataset === "domi:base:domi")).toMatchObject({ modo: "reemplazar", upload: true });
    expect(planBases(files, existing, "adicional").find((u) => u.dataset === "domi:base:domi")).toMatchObject({ modo: "adicional", upload: true });
  });
});
