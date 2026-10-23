import { describe, expect, it } from "vitest";
import { planBulk } from "./bulk";

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
