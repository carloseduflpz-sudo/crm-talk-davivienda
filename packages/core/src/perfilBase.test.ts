import { describe, expect, it } from "vitest";
import { DIMENSIONES_BASE, SIN_DATO, recomendaciones, valorDimension, type PerfilMes } from "./perfilBase";

describe("perfil de la base", () => {
  const edad = DIMENSIONES_BASE["cdc:base:cdc"]!.find((d) => d.key === "edad")!;
  const traslado = DIMENSIONES_BASE["cdc:base:cdc"]!.find((d) => d.key === "traslado")!;
  it("agrupa números en rangos y deja el texto tal cual", () => {
    expect(valorDimension(edad, "24")).toBe("Hasta 25");
    expect(valorDimension(edad, 30)).toBe("26 a 35");
    expect(valorDimension(edad, "61")).toBe("Más de 55");
    expect(valorDimension(traslado, "$1,500.00")).toBe("$1,001 a $2,000");
    expect(valorDimension({ key: "perfil", label: "Perfil", campo: "profile" }, "  P1  ")).toBe("P1");
    expect(valorDimension(edad, "")).toBe(SIN_DATO);
    expect(valorDimension(edad, "-")).toBe(SIN_DATO);
  });
  it("recomienda el perfil y la franja que más superan la conversión de la base", () => {
    const m: PerfilMes = {
      month: "2026-10",
      base: 1000,
      conLlamadas: true,
      dimensiones: [{ key: "perfil", label: "Perfil", valores: [] }],
      horas: [],
      dias: [],
      cruces: [
        { key: "perfil", valor: "P1", franja: "9:00 a 10:59", llamadas: 300, efectivos: 100, ventas: 10 },
        { key: "perfil", valor: "P2", franja: "9:00 a 10:59", llamadas: 300, efectivos: 100, ventas: 2 },
        { key: "perfil", valor: "P1", franja: "15:00 a 16:59", llamadas: 100, efectivos: 10, ventas: 5 },
      ],
    };
    const r = recomendaciones(m);
    // Promedio de la base: 17 ventas / 210 contactos = 8.1%. P1 de 9 a 11: 10% (1.2 veces); P1 15-17 tiene pocos contactos.
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ dimension: "Perfil", valor: "P1", franja: "9:00 a 10:59", ventas: 10 });
    expect(r[0]!.veces).toBeCloseTo(0.1 / (17 / 210), 6);
  });
});
