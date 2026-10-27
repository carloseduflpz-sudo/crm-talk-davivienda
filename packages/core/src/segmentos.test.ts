/* Conversión por segmento: etiquetas, rangos y qué segmentos van en la gráfica. */
import { describe, expect, it } from "vitest";
import { esColumnaDeSegmento, extremos, segmentosConversion, type PresSegmentoFila } from "./segmentos";

const fila = (columna: string, valor: string | number, clientes: number, contactados: number, ventas: number, rem: 0 | 1 = 0): PresSegmentoFila => ({ columna, valor, rem, clientes, contactados, ventas });

describe("conversión por segmento", () => {
  it("las columnas que identifican a la persona no son segmentos", () => {
    for (const c of ["NIU", "DUI", "Nombre", "Correo", "Telefono", "TelNotificaciones", "Municipio", "Fecha de Entrega", "Dirección de Casa"]) expect(esColumnaDeSegmento(c)).toBe(false);
    for (const c of ["Perfil", "Tasa", "Monto", "Segmento Empresa", "Tipo de TC", "AplicaCDC", "Edad"]) expect(esColumnaDeSegmento(c)).toBe(true);
  });

  it("etiquetas como en la presentación: Perfil P1, Tasa 16%, el valor tal cual y Sí/No con el nombre de la columna", () => {
    const segs = segmentosConversion([
      fila("Perfil", "P1", 500, 200, 4),
      fila("Perfil", "P3", 500, 200, 20),
      fila("Tasa", 0.16, 400, 160, 5),
      fila("Tasa", 0.22, 600, 240, 30),
      fila("Tarjeta", "PLATINUM", 300, 100, 2),
      fila("Tarjeta", "Clásica", 700, 300, 21),
      fila("AplicaCDC", "Si", 600, 250, 10),
      fila("AplicaCDC", "No", 400, 150, 14),
    ]);
    const labels = segs.map((s) => s.label);
    expect(labels).toContain("Perfil P1");
    expect(labels).toContain("Tasa 16%");
    expect(labels).toContain("Platinum");
    expect(labels).toContain("Clásica");
    expect(labels).toContain("Aplica CDC");
    expect(labels).toContain("Aplica CDC: No");
    // De menor a mayor conversión (ventas ÷ contactados).
    expect(segs[0]!.label).toBe("Perfil P1");
    expect(segs[0]!.conv).toBeCloseTo(2, 6);
    expect(segs.at(-1)!.label).toBe("Tasa 22%");
  });

  it("columnas numéricas en rangos con bordes redondos ($2K-3K, hasta, mayor a)", () => {
    const filas = Array.from({ length: 40 }, (_, i) => fila("Monto", 500 + i * 250, 25, 10, i % 4));
    const labels = segmentosConversion(filas).map((s) => s.label);
    expect(labels.length >= 3 && labels.length <= 4).toBe(true);
    expect(labels.some((l) => /^Monto hasta \$\d/.test(l))).toBe(true);
    expect(labels.some((l) => /^Monto mayor a \$\d/.test(l))).toBe(true);
    expect(labels.some((l) => /^Monto \$\d+(\.\d)?K-\d+(\.\d)?K$/.test(l))).toBe(true);
  });

  it("segmentos muy chicos, o que son casi toda la base, no entran; números de teléfono tampoco", () => {
    const segs = segmentosConversion([
      fila("Segmento", "Gobierno", 20, 3, 1), // 3 contactados: muy pocos
      fila("Segmento", "Privada", 980, 400, 10), // 98% de la base
      fila("Base", "BAU", 1000, 403, 11), // toda la base
      ...Array.from({ length: 20 }, (_, i) => fila("Celular2", 70000000 + i, 50, 20, 1)),
    ]);
    expect(segs.map((s) => s.label)).toEqual([]);
  });

  it("el remanente solo cuenta cuando la gráfica lo pide; la gráfica lleva los 5 peores y los 5 mejores", () => {
    const filas = [fila("Perfil", "P1", 100, 50, 1), fila("Perfil", "P1", 100, 50, 9, 1), fila("Perfil", "P2", 100, 50, 5)];
    expect(segmentosConversion(filas).find((s) => s.label === "Perfil P1")!.ventas).toBe(1);
    expect(segmentosConversion(filas, true).find((s) => s.label === "Perfil P1")!.ventas).toBe(10);
    const muchos = Array.from({ length: 14 }, (_, i) => ({ label: `S${i}`, columna: "x", clientes: 1, contactados: 1, ventas: 0, conv: i }));
    expect(extremos(muchos).map((s) => s.label)).toEqual(["S0", "S1", "S2", "S3", "S4", "S9", "S10", "S11", "S12", "S13"]);
  });
});
