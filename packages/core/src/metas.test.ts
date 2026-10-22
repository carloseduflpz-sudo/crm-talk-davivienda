import { describe, expect, it } from "vitest";
import { businessDays, countsForGoal, suggestedHolidays } from "./metas";

describe("reglas de la meta", () => {
  it("estatus que cuentan por campaña (entregado, desembolsado, aplicado, activo)", () => {
    expect(countsForGoal("tdc", "ENTREGADA")).toBe(true);
    expect(countsForGoal("tdc", "Entregada por courier")).toBe(true);
    expect(countsForGoal("tdc", "APROBADA")).toBe(false);
    expect(countsForGoal("extrafin", "DESEMBOLSADO")).toBe(true);
    expect(countsForGoal("extrafin", "NO DESEMBOLSADO")).toBe(false);
    expect(countsForGoal("cdc", "APLICADA")).toBe(true);
    expect(countsForGoal("cdc", "NO APLICA")).toBe(false);
    expect(countsForGoal("seguros", "ACTIVO")).toBe(true);
  });

  it("días hábiles con fines de semana y feriados", () => {
    expect(businessDays("2026-09", [1, 2, 3, 4, 5], [])).toHaveLength(22);
    expect(businessDays("2026-09", [1, 2, 3, 4, 5], ["2026-09-15"])).toHaveLength(21);
    expect(businessDays("2026-09", [1, 2, 3, 4, 5, 6], [])).toHaveLength(26);
    expect(businessDays("2026-02", [0, 1, 2, 3, 4, 5, 6], [])).toHaveLength(28);
    expect(businessDays("2026-10", [1, 2, 3, 4, 5], [])[0]).toBe("2026-10-01");
  });

  it("feriados sugeridos de El Salvador, con Semana Santa móvil", () => {
    // Pascua 2026: 5 de abril.
    expect(suggestedHolidays("2026-04").map((h) => h.date)).toEqual(["2026-04-02", "2026-04-03", "2026-04-04"]);
    expect(suggestedHolidays("2027-03").map((h) => h.date)).toEqual(["2027-03-25", "2027-03-26", "2027-03-27"]);
    expect(suggestedHolidays("2026-11").map((h) => h.name)).toEqual(["Día de los Difuntos"]);
    expect(suggestedHolidays("2026-07")).toEqual([]);
  });
});
