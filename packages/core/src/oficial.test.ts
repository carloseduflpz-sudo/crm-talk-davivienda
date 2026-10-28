/* Excel de cumplimientos de campaña: una hoja por año y un bloque por campaña. */
import { describe, expect, it } from "vitest";
import { leerCumplimientos, unirOficial } from "./oficial";

const MESES = ["Mes", "Enero", "Febrero", "Marzo ", "Abril", "Mayo", "Junio  ", "Julio", "Agosto", "Septimebre", "Octubre", "Noviemre", "Diciembre", "Cumplimiento Anual", "Gap"];
const bloque = (nombre: string, meta: (number | null)[], real: (number | null)[]) => [
  [nombre],
  MESES,
  // Meses que faltan, vacíos; después del último mes, el total anual (no se lee).
  ["Meta", ...meta, ...Array(12 - meta.length).fill(null), 999999],
  ["Real ", ...real, ...Array(12 - real.length).fill(null), 888888],
  ["Cumplimiento ", 0.5, "#DIV/0!"],
  ["Gap Mensual", -10, -20],
  [],
];

describe("archivo de cumplimientos", () => {
  it("lee meta y real de cada campaña y mes (aguanta meses mal escritos y celdas vacías o con #DIV/0!)", () => {
    const r = leerCumplimientos({
      "2026": [
        ...bloque("SEGUROS", [480, 480, null], [254, 305, null]),
        ...bloque("INCREMENTO ", [950, 716], [833, 765]),
        ...bloque("CDC", [245943.75, ...Array(7).fill(null), 293375], [305666.7, ...Array(7).fill(null), 256227.004]),
      ],
      "Hoja sin año": [["SEGUROS"], MESES, ["Meta", 1]],
    });
    expect(r.avisos).toEqual([]);
    expect(r.meses).toEqual([
      { campaign: "cdc", month: "2026-01", meta: 245943.75, real: 305666.7 },
      { campaign: "cdc", month: "2026-09", meta: 293375, real: 256227 },
      { campaign: "seguros", month: "2026-01", meta: 480, real: 254 },
      { campaign: "seguros", month: "2026-02", meta: 480, real: 305 },
      { campaign: "upin", month: "2026-01", meta: 950, real: 833 },
      { campaign: "upin", month: "2026-02", meta: 716, real: 765 },
    ]);
  });

  it("un bloque con un nombre que no es campaña se avisa y no se lee", () => {
    const r = leerCumplimientos({ "2025": bloque("COBROS", [1], [1]) });
    expect(r.meses).toEqual([]);
    expect(r.avisos[0]).toContain("COBROS");
  });

  it("al subir otro archivo, sus meses reemplazan a los mismos meses y los demás se quedan", () => {
    const antes = [
      { campaign: "tdc" as const, month: "2025-12", meta: 228, real: 111 },
      { campaign: "tdc" as const, month: "2026-01", meta: 289, real: 100 },
    ];
    expect(unirOficial(antes, [{ campaign: "tdc", month: "2026-01", meta: 289, real: 109 }])).toEqual([
      { campaign: "tdc", month: "2025-12", meta: 228, real: 111 },
      { campaign: "tdc", month: "2026-01", meta: 289, real: 109 },
    ]);
  });
});
