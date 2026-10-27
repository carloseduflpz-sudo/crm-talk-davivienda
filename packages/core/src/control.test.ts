import { describe, expect, it } from "vitest";
import { aplicarControl, cuadrarControl, leerControl, type Hoja } from "./control";
import type { PresentacionCampania } from "./presentacion";

/* Hojas con la misma forma que el Excel de las gráficas (hoja TALK y una hoja por campaña). */
const talk: Hoja = [
  [null, "Mes", "Octubre", "Dias", 22],
  [null, null, 5, "MTD", 15],
  [],
  [null, "TDC", 7],
  [null, "HC", "Meta", "META MTD", "META MTD ASESOR", "Meta Semanal "],
  ["TARJETAS DE CREDITO", 7, 253, 172.5, 24.64, 50.6],
  ["UPGRADE", 4, 990, 675, 168.75, 198],
];
const bau: Hoja = [
  ["TARJETAS DE CREDITO"],
  [],
  ["Meta MTD", 172.5],
  ["Resultado", 69],
  ["Cumplimiento", 0.4],
  ["Cantado Vs Activo "],
  ["Registros Unicos", 15],
  ["Registros Recorridos", 10],
  ["Nuevo", 5],
  ["Ventas Cantadas", 12],
  ["Ventas Activas", 8],
  [],
  ["Categoria ", "Cantidad"],
  ["No contacto", 6],
  ["Sin Tipificar", 4],
  [],
  ["Mes ", "Enero"],
  ["Cumplimiento", 0.9],
];
const primeras: Hoja = [["TARJETAS DE CREDITO"], ["Registros Unicos", 10], ["Registros Recorridos", 7]];

const tdc: PresentacionCampania = {
  campaign: "tdc",
  month: "2026-10",
  unidad: "ventas",
  meta: 253,
  hc: 7,
  esperado: (253 / 22) * 16,
  diasHabiles: { transcurridos: 16, total: 22 },
  resultado: 69,
  fechaCorte: "2026-10-22",
  fechasPosteriores: null,
  bases: [
    { dataset: "tdc:base:primeras", unicos: 10, recorridos: 7, contactados: 0, llamadas: 0, unIntento: 0, conVenta: 0, montoVenta: 0, mesAnterior: null, contacto: [{ label: "No contacto", n: 5 }, { label: "Sin asignar a un agente", n: 2 }] },
    { dataset: "tdc:base:segundas", unicos: 5, recorridos: 3, contactados: 0, llamadas: 0, unIntento: 0, conVenta: 0, montoVenta: 0, mesAnterior: null, contacto: [{ label: "No contacto", n: 1 }, { label: "Sin tipificar", n: 2 }] },
  ],
  ventas: [
    { grupo: "tdc:base:primeras", origen: "mes", estatus: "ENTREGADA", k: 1, proceso: "", semana: 2, ops: 6, clientes: 0, valor: 6 },
    { grupo: "tdc:base:primeras", origen: "mes", estatus: "RECHAZADA", k: 0, proceso: "", semana: 2, ops: 4, clientes: 0, valor: 4 },
    { grupo: "tdc:base:primeras", origen: "cosecha", estatus: "ENTREGADA", k: 1, proceso: "", semana: null, ops: 2, clientes: 0, valor: 2 },
  ],
  motivos: [],
  trimestre: [{ month: "2026-10", meta: (253 / 22) * 16, metaPorAgente: (253 / 22) * 16 / 7, mtd: true, resultado: 69, porAgente: [], agentes: [] }],
};

describe("Excel de control", () => {
  const ctrl = leerControl({ TALK: talk, TARCRED_BAU: bau, "TARCRED_1CTS ": primeras });

  it("lee la hoja TALK y las hojas de campaña (la base sale del nombre de la hoja)", () => {
    expect(ctrl).toMatchObject({ diasMes: 22, diasMTD: 15 });
    expect(ctrl.campanas).toEqual([
      { campaign: "tdc", nombre: "TARJETAS DE CREDITO", hc: 7, meta: 253, metaMTD: 172.5, metaSemanal: 50.6 },
      { campaign: "upin", nombre: "UPGRADE", hc: 4, meta: 990, metaMTD: 675, metaSemanal: 198 },
    ]);
    expect(ctrl.hojas[0]).toMatchObject({ hoja: "TARCRED_BAU", campaign: "tdc", grupo: null, valores: { metaMTD: 172.5, resultado: 69, cumplimiento: 0.4, unicos: 15, recorridos: 10, nuevo: 5, cantadas: 12, activas: 8 } });
    expect(ctrl.hojas[0]!.contacto).toEqual([{ label: "No contacto", n: 6 }, { label: "Sin Tipificar", n: 4 }]);
    expect(ctrl.hojas[1]).toMatchObject({ grupo: "tdc:base:primeras", valores: { unicos: 10, recorridos: 7 } });
  });

  it("compara cifra por cifra y explica de dónde sale lo que no cuadra", () => {
    const f = cuadrarControl(ctrl, { tdc });
    const fila = (hoja: string, dato: string) => f.find((x) => x.hoja === hoja && x.dato === dato)!;
    expect(fila("TALK", "Meta del mes")).toMatchObject({ excel: 253, app: 253, cuadra: true });
    expect(fila("TALK", "Días hábiles transcurridos")).toMatchObject({ excel: 15, app: 16, cuadra: false });
    expect(fila("TALK", "Días hábiles transcurridos").como).toContain("22 de octubre");
    expect(fila("TALK", "Meta MTD")).toMatchObject({ excel: 172.5, cuadra: false });
    expect(fila("TARCRED_BAU", "Cumplimiento MTD")).toMatchObject({ excel: 40, cuadra: false });
    expect(fila("TARCRED_BAU", "Registros recorridos")).toMatchObject({ excel: 10, app: 10, cuadra: true });
    // Ventas cantadas = del mes (6 + 4) + cosecha activa (2); activas = 6 + 2.
    expect(fila("TARCRED_BAU", "Ventas cantadas")).toMatchObject({ app: 12, cuadra: true });
    expect(fila("TARCRED_BAU", "Ventas activas")).toMatchObject({ app: 8, cuadra: true });
    // "Sin asignar a un agente" va con "Sin Tipificar".
    expect(fila("TARCRED_BAU", "Contacto: Sin Tipificar")).toMatchObject({ app: 4, cuadra: true });
    expect(fila("TARCRED_1CTS ", "Registros únicos")).toMatchObject({ app: 10, cuadra: true });
    // UPIN está en el Excel pero no en la app: no se compara.
    expect(f.some((x) => x.campaign === "upin")).toBe(false);
  });

  it("la presentación toma del Excel la M, la R y el contacto; lo demás sigue siendo de la app", () => {
    const d = aplicarControl({ tdc }, ctrl).tdc!;
    expect(d).toMatchObject({ meta: 253, hc: 7, esperado: 172.5, resultado: 69, diasHabiles: { transcurridos: 15, total: 22 } });
    expect(d.contactoExcel).toEqual({ "*": [{ label: "No contacto", n: 6 }, { label: "Sin Tipificar", n: 4 }] });
    // Recorridos de cada base: de la hoja de esa base (1CTS); la hoja general no se reparte entre dos bases.
    expect(d.bases.map((b) => [b.dataset, b.recorridos])).toEqual([
      ["tdc:base:primeras", 7],
      ["tdc:base:segundas", 3],
    ]);
    expect(d.ventas).toBe(tdc.ventas);
    expect(d.trimestre[0]).toMatchObject({ meta: 172.5, resultado: 69 });
    expect(d.trimestre[0]!.metaPorAgente!).toBeCloseTo(172.5 / 7, 6);
    expect(cuadrarControl(ctrl, { tdc: d }).find((x) => x.dato === "Meta MTD")!.cuadra).toBe(true);
  });

  it("si el Excel es de la semana pasada (la sábana va 3+ días hábiles adelante), M, R y contacto salen de lo cargado y se avisa", () => {
    const nuevo = { ...tdc, diasHabiles: { transcurridos: 20, total: 22 }, esperado: 230, resultado: 140 };
    const d = aplicarControl({ tdc: nuevo }, ctrl).tdc!;
    // La meta del mes y el HC siguen siendo los del Excel; la M es esa meta a los 20 días que lleva la sábana.
    expect(d).toMatchObject({ meta: 253, hc: 7, resultado: 140, diasHabiles: { transcurridos: 20, total: 22 } });
    expect(d.esperado!).toBeCloseTo((253 / 22) * 20, 6);
    expect(d.contactoExcel).toBe(nuevo.contactoExcel);
    expect(d.avisoExcel).toContain("día hábil 15");
    // 1 día de diferencia (16 contra 15) es normal: se respeta el Excel.
    expect(aplicarControl({ tdc }, ctrl).tdc!.avisoExcel).toBe(undefined);
  });
});
