/* Las cifras del análisis se comparan contra un cálculo hecho a mano sobre los mismos datos. */
import type { CampaignAnalysis } from "@crm/core";
import { beforeAll, describe, expect, it } from "vitest";
import { memoryD1 } from "../test/d1";
import { createApp } from "./app";
import { SESSION_COOKIE } from "./auth";
import type { Env } from "./env";

const app = createApp();
let env: Env;
let cookie = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await app.handle(
    new Request("https://crm.test/api" + path, {
      method,
      headers: { cookie: `${SESSION_COOKIE}=${cookie}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    () => {},
  );
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1] ?? "";
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

async function load(dataset: string, month: string, rows: unknown[]) {
  const c = await call("POST", "/cargas", { campaign: dataset.split(":")[0], dataset, month, fileName: "x.xlsx", fileSha256: "c".repeat(64), rowsTotal: rows.length, rowsValid: rows.length, rowsDiscarded: 0 });
  expect(c.status, String(c.data.error)).toBe(201);
  expect((await call("POST", `/cargas/${c.data.id}/filas`, { seq: 0, rows })).status).toBe(200);
  expect((await call("POST", `/cargas/${c.data.id}/confirmar`, {})).status).toBe(200);
}

/* ---------- datos inventados con resultado conocido ---------- */
const STATUS = ["ENTREGADA", "APROBADA", "RECHAZADA", "EN ANALISIS", "RECHAZADA"];
const sabanaSep = Array.from({ length: 20 }, (_, i) => ({
  niu: String(100 + i),
  saleDate: `2026-09-${String(1 + (i % 10)).padStart(2, "0")}`,
  executive: i % 2 ? "Ana" : "Luis",
  statusRaw: STATUS[i % 5],
  reason: STATUS[i % 5] === "RECHAZADA" ? (i % 3 ? "Score" : "Capacidad") : null,
}));
const sabanaAgo = Array.from({ length: 6 }, (_, i) => ({ niu: String(900 + i), saleDate: "2026-08-15", executive: "Ana", statusRaw: i < 4 ? "ENTREGADA" : "RECHAZADA" }));
const basePrimeras = Array.from({ length: 30 }, (_, i) => ({ niu: String(100 + i), profile: i % 3 ? "Asalariado" : "Independiente" }));
const baseSegundas = Array.from({ length: 10 }, (_, i) => ({ niu: String(125 + i), profile: "Asalariado" })); // 5 repetidos con primeras
const calls = [
  // cliente 100: no contesta, luego venta en el 2.º intento
  { niu: "100", agent: "Ana", calledAt: "2026-09-01T09:00:00", category: "No contacto", tipologia: "No contesta" },
  { niu: "100", agent: "Ana", calledAt: "2026-09-02T09:00:00", category: "Contacto efectivo positivo", tipologia: "Venta realizada" },
  // cliente 101: venta al primer intento
  { niu: "101", agent: "Luis", calledAt: "2026-09-01T10:00:00", category: "Contacto efectivo positivo", tipologia: "Venta realizada" },
  // cliente 102: negativo
  { niu: "102", agent: "Luis", calledAt: "2026-09-01T11:00:00", category: "Contacto efectivo negativo", tipologia: "No le interesa" },
  // cliente 103: mensaje con familiar (no efectivo), 3 intentos
  { niu: "103", agent: "Ana", calledAt: "2026-09-01T12:00:00", category: "Contacto no efectivo", tipologia: "Mensaje con familiar" },
  { niu: "103", agent: "Ana", calledAt: "2026-09-02T12:00:00", category: "No contacto", tipologia: "Buzon de voz" },
  { niu: "103", agent: "Luis", calledAt: "2026-09-03T12:00:00", category: "No contacto", tipologia: "Buzon de voz" },
  // llamada sin NIU
  { niu: "", agent: "Luis", calledAt: "2026-09-03T13:00:00", category: "Sin Tipificar", tipologia: "Sin Tipificar" },
];
const crm = [
  { niu: "100", agent: "Ana", enteredAt: "2026-09-02T09:10:00", product: "Clásica" },
  { niu: "101", agent: "Luis", enteredAt: "2026-09-01T10:10:00", product: "Oro" },
  { niu: "555", agent: "Luis", enteredAt: "2026-09-03T10:10:00", product: "Oro" }, // aún sin estatus del banco
];

let a: CampaignAnalysis;
beforeAll(async () => {
  env = { ASSETS: {} as Fetcher, DB: memoryD1(), FILES: { head: async () => null } as unknown as R2Bucket, APP_ENV: "production", SETUP_TOKEN: "clave-de-configuracion-123" };
  await call("POST", "/auth/configurar", { token: env.SETUP_TOKEN, username: "carlos", displayName: "Carlos", password: "Davivienda2026" });
  await load("tdc:sabana", "2026-08", sabanaAgo);
  await load("tdc:sabana", "2026-09", sabanaSep);
  await load("tdc:base:primeras", "2026-09", basePrimeras);
  await load("tdc:base:segundas", "2026-09", baseSegundas);
  await load("tdc:tipif", "2026-09", calls);
  await load("tdc:ventas", "2026-09", crm);
  expect((await call("PUT", "/metas", { campaign: "tdc", month: "2026-09", salesGoal: 40, agents: 2 })).status).toBe(200);
  const r = await call("GET", "/analisis/tdc?mes=2026-09");
  expect(r.status, String(r.data.error)).toBe(200);
  a = r.data.analysis as CampaignAnalysis;
});

describe("análisis TDC septiembre (datos de prueba)", () => {
  it("meses disponibles y archivos vigentes", () => {
    expect(a.months).toEqual(["2026-09", "2026-08"]);
    expect(a.loaded.map((l) => l.dataset).sort()).toEqual(["tdc:base:primeras", "tdc:base:segundas", "tdc:sabana", "tdc:tipif", "tdc:ventas"]);
  });

  it("fechas: hasta qué día llegan los datos; ningún archivo trae filas de otro mes", () => {
    expect(a.fechas).toEqual({ hasta: "2026-09-10", fuera: [] });
  });

  it("ventas: totales, aprobación y rechazo por motivo", () => {
    const apr = sabanaSep.filter((r) => r.statusRaw === "ENTREGADA" || r.statusRaw === "APROBADA").length;
    const rech = sabanaSep.filter((r) => r.statusRaw === "RECHAZADA").length;
    expect(a.ventas).toMatchObject({ total: 20, aprobadas: apr, rechazadas: rech, enProceso: 20 - apr - rech });
    expect(a.ventas!.aprobacion).toBeCloseTo((apr / (apr + rech)) * 100, 6);
    const motivos = Object.entries(
      sabanaSep.filter((r) => r.reason).reduce<Record<string, number>>((m, r) => ((m[r.reason!] = (m[r.reason!] ?? 0) + 1), m), {}),
    ).sort((x, y) => y[1] - x[1]);
    expect(a.ventas!.rechazoPorMotivo.map((m) => [m.label, m.value])).toEqual(motivos);
  });

  it("ventas por ejecutivo y por día", () => {
    const ana = sabanaSep.filter((r) => r.executive === "Ana");
    const row = a.ventas!.porEjecutivo.find((e) => e.agent === "Ana")!;
    expect(row.ventas).toBe(ana.length);
    expect(row.aprobadas).toBe(ana.filter((r) => ["ENTREGADA", "APROBADA"].includes(r.statusRaw!)).length);
    expect(a.ventas!.porDia).toHaveLength(10);
    expect(a.ventas!.porDia.reduce((s, d) => s + d.ventas, 0)).toBe(20);
  });

  it("comparativo mensual incluye agosto y septiembre", () => {
    expect(a.ventas!.mensual.map((m) => [m.month, m.ventas, m.aprobadas, m.rechazadas])).toEqual([
      ["2026-08", 6, 4, 2],
      ["2026-09", 20, a.ventas!.aprobadas, a.ventas!.rechazadas],
    ]);
  });

  it("base: clientes únicos entre las dos bases y cruce por perfil", () => {
    const unicos = new Set([...basePrimeras, ...baseSegundas].map((b) => b.niu));
    expect(a.base!.total).toBe(unicos.size); // 35
    const sabanaNius = new Set(sabanaSep.map((s) => s.niu));
    const conVenta = [...unicos].filter((nu) => sabanaNius.has(nu)).length;
    expect(a.base!.porPerfil.reduce((s, p) => s + p.conVenta, 0)).toBe(conVenta);
    expect(a.base!.porPerfil.reduce((s, p) => s + p.base, 0)).toBe(unicos.size);
  });

  it("llamadas: contactabilidad, registros, intentos y ventas por intento", () => {
    const L = a.llamadas!;
    expect(L.total).toBe(8);
    expect(L.registros).toBe(4);
    // efectivo = venta + negativo + no efectivo (regla por defecto): 2 ventas + 1 negativo + 1 mensaje
    expect(L.efectivos).toBe(4);
    expect(L.contactabilidad).toBeCloseTo(50, 6);
    expect(L.ventasPrimerIntento).toBe(1);
    expect(L.ventasRellamado).toBe(1);
    expect(L.primerContacto).toBe(4);
    expect(L.seguimiento).toBe(3);
    expect(L.intentos).toEqual([
      { intentos: "1", clientes: 2 },
      { intentos: "2", clientes: 1 },
      { intentos: "3", clientes: 1 },
    ]);
    expect(L.ventasUnicas).toBe(2);
    expect(L.penetracion).toBeCloseTo((2 / 35) * 100, 6);
    const ana = L.porAgente.find((x) => x.agent === "Ana")!;
    expect(ana).toMatchObject({ llamadas: 4, registros: 2, ventas: 1, noContacto: 2, efectivos: 2 });
  });

  it("CRM: ventas capturadas y cuántas ya tienen estatus del banco", () => {
    expect(a.crm).toMatchObject({ total: 3, conEstatusBanco: 2 });
  });

  it("cumplimiento: solo cuenta lo entregado, en días hábiles (lunes a viernes por defecto)", () => {
    const c = a.cumplimiento;
    const entregadas = sabanaSep.filter((r) => r.statusRaw === "ENTREGADA");
    expect(c.config).toEqual({ estatus: ["ENTREGADA"], estatusPorDefecto: true, diasSemana: [1, 2, 3, 4, 5], feriados: [] });
    expect(c.estatusDisponibles.find((e) => e.label === "APROBADA")?.cuenta).toBe(false);
    expect(c).toMatchObject({ meta: 40, agentes: 2, metaPorAgente: 20, ventas: entregadas.length, ventasTotales: 20, fechaCorte: "2026-09-10" });
    // Septiembre 2026: 22 días hábiles; al jueves 10 van 8 (1 sep es martes).
    expect(c).toMatchObject({ diasDelMes: 22, diaDelMes: 8, diasRestantes: 14, faltan: 40 - entregadas.length });
    expect(c.avance).toBeCloseTo((entregadas.length / 40) * 100, 6);
    expect(c.ritmoDiario).toBeCloseTo(entregadas.length / 8, 6);
    expect(c.proyeccion).toBe(Math.round(entregadas.length + (entregadas.length / 8) * 14));
    expect(c.ritmoNecesario).toBeCloseTo((40 - entregadas.length) / 14, 6);
    expect(c.esperado).toBeCloseTo((40 * 8) / 22, 6);
    const ana = c.porAgente.find((x) => x.agent === "Ana")!;
    const anaEntregadas = entregadas.filter((r) => r.executive === "Ana").length;
    expect(ana).toMatchObject({ ventas: anaEntregadas, total: sabanaSep.filter((r) => r.executive === "Ana").length, gap: 20 - anaEntregadas });
    expect(c.feriadosSugeridos.map((f) => f.date)).toEqual(["2026-09-15"]);
  });

  it("sin mes pedido usa el más reciente; un mes sin archivos no rompe nada", async () => {
    const r = await call("GET", "/analisis/tdc");
    expect((r.data.analysis as CampaignAnalysis).month).toBe("2026-09");
    const vacio = (await call("GET", "/analisis/upin")).data.analysis as CampaignAnalysis;
    expect(vacio).toMatchObject({ month: null, months: [], ventas: null, base: null, llamadas: null, crm: null });
  });

  it("la meta guarda qué estatus cuentan, los días hábiles y los feriados", async () => {
    const put = await call("PUT", "/metas", { campaign: "tdc", month: "2026-09", salesGoal: 40, agents: 2, countedStatuses: ["ENTREGADA", "APROBADA"], workDays: [1, 2, 3, 4, 5], holidays: ["2026-09-15"] });
    expect(put.status, String(put.data.error)).toBe(200);
    const c = ((await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis as CampaignAnalysis).cumplimiento;
    expect(c.config).toEqual({ estatus: ["ENTREGADA", "APROBADA"], estatusPorDefecto: false, diasSemana: [1, 2, 3, 4, 5], feriados: ["2026-09-15"] });
    expect(c.ventas).toBe(sabanaSep.filter((r) => r.statusRaw === "ENTREGADA" || r.statusRaw === "APROBADA").length);
    expect(c).toMatchObject({ diasDelMes: 21, diaDelMes: 8, diasRestantes: 13 });
    // Sábados también: septiembre suma 4 sábados (5, 12, 19, 26); al día 10 ya pasó el 5.
    await call("PUT", "/metas", { campaign: "tdc", month: "2026-09", salesGoal: 40, agents: 2, countedStatuses: null, workDays: [1, 2, 3, 4, 5, 6], holidays: [] });
    const c2 = ((await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis as CampaignAnalysis).cumplimiento;
    expect(c2).toMatchObject({ diasDelMes: 26, diaDelMes: 9 });
    expect(c2.config.estatusPorDefecto).toBe(true);
    // Se deja como al inicio para las demás pruebas.
    await call("PUT", "/metas", { campaign: "tdc", month: "2026-09", salesGoal: 40, agents: 2 });
  });

  it("CDC y Extra: la meta se mide en dólares (monto de lo aplicado o desembolsado)", async () => {
    await load("cdc:sabana", "2026-09", [
      { niu: "1", saleDate: "2026-09-01", executive: "Ana", statusRaw: "APLICADA", amount: 1000 },
      { niu: "2", saleDate: "2026-09-02", executive: "Ana", statusRaw: "APLICADA", amount: 2500.5 },
      { niu: "3", saleDate: "2026-09-03", executive: "Luis", statusRaw: "APLICADA", amount: 500 },
      { niu: "4", saleDate: "2026-09-03", executive: "Luis", statusRaw: "NO APLICA", amount: 900 },
    ]);
    expect((await call("PUT", "/metas", { campaign: "cdc", month: "2026-09", salesGoal: 10000.5, agents: 2 })).status).toBe(200);
    const c = ((await call("GET", "/analisis/cdc?mes=2026-09")).data.analysis as CampaignAnalysis).cumplimiento;
    expect(c).toMatchObject({ unidad: "monto", meta: 10000.5, ventas: 4000.5, ventasTotales: 4900.5, operaciones: 3, operacionesTotales: 4 });
    expect(c.porAgente.find((x) => x.agent === "Ana")).toMatchObject({ ventas: 3500.5, operaciones: 2, total: 3500.5 });
    expect(c.estatusDisponibles.find((e) => e.label === "NO APLICA")).toMatchObject({ value: 1, monto: 900, cuenta: false });
    expect(a.cumplimiento.unidad).toBe("ventas"); // TDC se mide en ventas
    // MTD: la meta repartida en días hábiles; corte jueves 3 de septiembre = día hábil 3 de 22.
    expect(c).toMatchObject({ fechaCorte: "2026-09-03", diaDelMes: 3, diasDelMes: 22 });
    expect(c.esperado).toBeCloseTo((10000.5 * 3) / 22, 6);
    expect(c.avanceMTD).toBeCloseTo((4000.5 / ((10000.5 * 3) / 22)) * 100, 6);
    const anaMTD = c.porAgente.find((x) => x.agent === "Ana")!;
    expect(anaMTD.metaMTD).toBeCloseTo((5000.25 * 3) / 22, 6);
    expect(anaMTD.gapMTD).toBeCloseTo((5000.25 * 3) / 22 - 3500.5, 6);
    // La pestaña Ventas también trae los montos.
    const v = ((await call("GET", "/analisis/cdc?mes=2026-09")).data.analysis as CampaignAnalysis).ventas!;
    expect(v.monto).toEqual({ total: 4900.5, aprobado: 4000.5, rechazado: 900, enProceso: 0 });
    expect(v.porEjecutivo.find((x) => x.agent === "Luis")).toMatchObject({ monto: 1400, montoAprobado: 500 });
    expect(v.porDia.find((d) => d.date === "2026-09-03")).toMatchObject({ monto: 1400, montoAprobado: 500 });
  });

  it("validaciones de la meta", async () => {
    expect((await call("PUT", "/metas", { campaign: "tdc", month: "2026-09", salesGoal: 10, workDays: [] })).status).toBe(400);
    expect((await call("PUT", "/metas", { campaign: "tdc", month: "2026-09", salesGoal: 10, holidays: ["2026-10-01"] })).status).toBe(400);
    expect((await call("PUT", "/metas", { campaign: "tdc", month: "2026-09", salesGoal: 10, countedStatuses: "ENTREGADA" })).status).toBe(400);
    expect((await call("PUT", "/metas", { campaign: "tdc", month: "2026-09", salesGoal: -1 })).status).toBe(400);
    expect((await call("PUT", "/metas", { campaign: "xx", month: "2026-09", salesGoal: 10 })).status).toBe(400);
  });

  it("lista de agentes del mes, sin repetir", () => {
    expect(a.agentes).toEqual(["Ana", "Luis"]);
    expect(a.agente).toBeNull();
  });

  it("filtro por agente: ventas, llamadas, CRM y meta individual", async () => {
    const r = await call("GET", "/analisis/tdc?mes=2026-09&agente=Ana");
    const f = r.data.analysis as CampaignAnalysis;
    const ana = sabanaSep.filter((x) => x.executive === "Ana");
    expect(f.agente).toBe("Ana");
    expect(f.ventas!.total).toBe(ana.length);
    expect(f.ventas!.porEjecutivo.map((e) => e.agent)).toEqual(["Ana"]);
    expect(f.ventas!.porDia.reduce((s, d) => s + d.ventas, 0)).toBe(ana.length);
    expect(f.llamadas!.total).toBe(calls.filter((c) => c.agent === "Ana").length);
    expect(f.crm!.total).toBe(crm.filter((c) => c.agent === "Ana").length);
    expect(f.base!.total).toBe(a.base!.total); // la base no depende del agente
    expect(f.cumplimiento.meta).toBe(20); // meta individual: 40 ÷ 2 agentes
    expect(f.cumplimiento.ventas).toBe(ana.filter((r) => r.statusRaw === "ENTREGADA").length);
    expect(f.cumplimiento.ventasTotales).toBe(ana.length);
    expect(f.agentes).toEqual(["Ana", "Luis"]);
  });
});

describe("detalle de clientes", () => {
  const det = async (qs: string) => (await call("GET", `/analisis/tdc/detalle?mes=2026-09&${qs}`)).data as { total: number; rows: Record<string, unknown>[]; columns: { key: string }[] };

  it("ventas por estatus, clase, motivo, día y agente", async () => {
    expect((await det("fuente=ventas&estatus=RECHAZADA")).total).toBe(sabanaSep.filter((r) => r.statusRaw === "RECHAZADA").length);
    expect((await det("fuente=ventas&estatus=ENTREGADA&estatus=APROBADA")).total).toBe(sabanaSep.filter((r) => r.statusRaw === "ENTREGADA" || r.statusRaw === "APROBADA").length);
    expect((await det("fuente=ventas&clase=aprobado")).total).toBe(a.ventas!.aprobadas);
    expect((await det("fuente=ventas&motivo=Score")).total).toBe(sabanaSep.filter((r) => r.reason === "Score").length);
    const d = await det("fuente=ventas&dia=2026-09-03");
    expect(d.total).toBe(sabanaSep.filter((r) => r.saleDate === "2026-09-03").length);
    expect(d.rows.every((r) => r.sale_date === "2026-09-03")).toBe(true);
    expect((await det("fuente=ventas&agente=Luis")).total).toBe(sabanaSep.filter((r) => r.executive === "Luis").length);
    expect((await det("fuente=ventas&desde=2026-09-01&hasta=2026-09-05")).total).toBe(sabanaSep.filter((r) => r.saleDate <= "2026-09-05").length);
  });

  it("llamadas por clase y tipificación; base por perfil; búsqueda por NIU", async () => {
    expect((await det("fuente=llamadas&clase=no_contacto")).total).toBe(calls.filter((c) => c.category === "No contacto").length);
    expect((await det("fuente=llamadas&tipologia=" + encodeURIComponent("Buzon de voz"))).total).toBe(2);
    expect((await det("fuente=base&perfil=Independiente")).total).toBe(basePrimeras.filter((b) => b.profile === "Independiente").length);
    const b = await det("fuente=ventas&buscar=105");
    expect(b.rows.map((r) => r.niu)).toEqual(["105"]);
    expect((await det("fuente=ventas&buscar=" + encodeURIComponent("%"))).total).toBe(0); // comodines escapados
  });

  it("límite de filas y validaciones", async () => {
    const d = await det("fuente=ventas&limite=3");
    expect(d.rows).toHaveLength(3);
    expect(d.total).toBe(20);
    expect(d.columns[0]!.key).toBe("niu");
    expect((await call("GET", "/analisis/tdc/detalle?mes=2026-09&fuente=usuarios")).status).toBe(400);
    expect((await call("GET", "/analisis/tdc/detalle?mes=2026-09&fuente=ventas&dia=ayer")).status).toBe(400);
    expect((await det("fuente=crm&agente=Luis")).total).toBe(2);
  });
});

describe("bases adicionales", () => {
  // 8 clientes: 3 ya venían en la base de primeras (NIU 127-129) y 5 son nuevos (200-204).
  const adicional = [...["127", "128", "129"], ...Array.from({ length: 5 }, (_, i) => String(200 + i))].map((niu) => ({ niu, profile: "Nuevo" }));
  let addId = "";

  it("se suma a la original del mes en vez de reemplazarla", async () => {
    const before = ((await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis as CampaignAnalysis).base!;
    const c = await call("POST", "/cargas", {
      campaign: "tdc", dataset: "tdc:base:primeras", month: "2026-09", fileName: "adicional.xlsx", fileSha256: "d".repeat(64),
      rowsTotal: adicional.length, rowsValid: adicional.length, rowsDiscarded: 0, mode: "adicional", label: "Adicional 15 sep",
    });
    expect(c.status, String(c.data.error)).toBe(201);
    addId = String(c.data.id);
    expect((await call("POST", `/cargas/${addId}/filas`, { seq: 0, rows: adicional })).status).toBe(200);
    const conf = await call("POST", `/cargas/${addId}/confirmar`, {});
    expect(conf.status).toBe(200);
    expect(conf.data.upload).toMatchObject({ isAddition: true, label: "Adicional 15 sep", isCurrent: true });

    const list = (await call("GET", "/cargas?campana=tdc")).data.uploads as { dataset: string; month: string; isCurrent: boolean; isAddition: boolean }[];
    expect(list.filter((u) => u.dataset === "tdc:base:primeras" && u.month === "2026-09" && u.isCurrent)).toHaveLength(2);

    const base = ((await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis as CampaignAnalysis).base!;
    expect(base.total).toBe(before.total + 5);
    expect(base.porCarga.map((x) => [x.dataset, x.adicional])).toEqual([
      ["tdc:base:primeras", false],
      ["tdc:base:segundas", false],
      ["tdc:base:primeras", true],
    ]);
    const add = base.porCarga[2]!;
    expect(add).toMatchObject({ nombre: "Adicional 15 sep", unicos: 8, nuevos: 5, repetidos: 3, llamados: 0, ventas: 0 });
    // Las bases originales: segundas solo cuenta como nuevos los que no venían en primeras.
    expect(base.porCarga[1]).toMatchObject({ unicos: 10, nuevos: 5, repetidos: 5 });
    expect(base.porCarga[0]!.nuevos + base.porCarga[1]!.nuevos + add.nuevos).toBe(base.total);
  });

  it("reemplazar la base original conserva las adicionales", async () => {
    await load("tdc:base:primeras", "2026-09", basePrimeras);
    const base = ((await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis as CampaignAnalysis).base!;
    expect(base.porCarga.filter((x) => x.adicional)).toHaveLength(1);
    expect(base.porCarga.filter((x) => x.dataset === "tdc:base:primeras")).toHaveLength(2);
  });

  it("una adicional se puede quitar y volver a sumar", async () => {
    expect((await call("POST", `/cargas/${addId}/quitar`, {})).status).toBe(200);
    let base = ((await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis as CampaignAnalysis).base!;
    expect(base.porCarga.some((x) => x.adicional)).toBe(false);
    expect((await call("POST", `/cargas/${addId}/activar`, {})).status).toBe(200);
    base = ((await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis as CampaignAnalysis).base!;
    expect(base.porCarga.filter((x) => x.adicional)).toHaveLength(1);
    expect((await call("POST", `/cargas/${addId}/quitar`, {})).status).toBe(200);
  });

  it("solo las bases pueden ser adicionales", async () => {
    const c = await call("POST", "/cargas", {
      campaign: "tdc", dataset: "tdc:sabana", month: "2026-09", fileName: "x.xlsx", fileSha256: "d".repeat(64),
      rowsTotal: 1, rowsValid: 1, rowsDiscarded: 0, mode: "adicional",
    });
    expect(c.status).toBe(400);
  });
});

describe("histórico", () => {
  it("un resumen por mes, del más antiguo al más reciente", async () => {
    const r = await call("GET", "/analisis/tdc/historico");
    expect(r.status, String(r.data.error)).toBe(200);
    const meses = r.data.meses as import("@crm/core").MonthSummary[];
    expect(meses.map((m) => m.month)).toEqual(["2026-08", "2026-09"]);
    expect(meses[0]).toMatchObject({ ventas: 6, aprobadas: 4, rechazadas: 2, base: null, llamadas: null, meta: null, cumplimiento: null });
    expect(meses[1]).toMatchObject({ ventas: 20, llamadas: 8, registros: 4, unidad: "ventas", meta: 40 });
    expect(meses[1]!.contactabilidad).toBeCloseTo(50, 6);
    expect(meses[1]!.diasHabiles).toBe(22);
    // Acumulado por día: los días 1 a 10 tienen 2 ventas cada uno.
    expect(meses[1]!.acumulado.ventas).toHaveLength(30);
    expect(meses[1]!.acumulado.ventas.slice(0, 3)).toEqual([2, 4, 6]);
    expect(meses[1]!.acumulado.ventas[29]).toBe(20);
    expect(meses[0]!.acumulado.ventas[13]).toBe(0);
    expect(meses[0]!.acumulado.ventas[14]).toBe(6);
    expect(meses[1]!.hasta).toBe("2026-09-10");
  });

  it("con filtro por agente", async () => {
    const meses = (await call("GET", "/analisis/tdc/historico?agente=Ana")).data.meses as import("@crm/core").MonthSummary[];
    expect(meses.find((m) => m.month === "2026-09")!.ventas).toBe(sabanaSep.filter((r) => r.executive === "Ana").length);
    expect(meses.find((m) => m.month === "2026-08")!.ventas).toBe(6);
  });
});

describe("cosecha: la sábana del mes trae ventas de meses anteriores", () => {
  it("cuenta para la meta lo que se activó este mes, sin repetir lo que ya contó antes", async () => {
    await load("tdc:sabana", "2026-10", [
      { niu: "1", saleDate: "2026-10-01", executive: "Ana", statusRaw: "ENTREGADA" },
      { niu: "2", saleDate: "2026-10-05", executive: "Ana", statusRaw: "EN ANALISIS" },
      { niu: "3", saleDate: "2026-09-29", executive: "Luis", statusRaw: "ENTREGADA" }, // vendida en septiembre, entregada en octubre
      { niu: "4", saleDate: "2026-09-30", executive: "Ana", statusRaw: "ENTREGADA" },
      { niu: "5", saleDate: "2026-08-30", executive: "Ana", statusRaw: "ENTREGADA" },
      { niu: "100", saleDate: "2026-09-01", executive: "Luis", statusRaw: "ENTREGADA" }, // ya contó en la sábana de septiembre
    ]);
    const oct = (await call("GET", "/analisis/tdc?mes=2026-10")).data.analysis as CampaignAnalysis;
    // No es un error: no se avisa como "filas de otro mes".
    expect(oct.fechas).toEqual({ hasta: "2026-10-05", fuera: [] });
    expect(oct.ventas!.total).toBe(6);
    expect(oct.ventas!.cosecha).toMatchObject({ total: 4, porMes: [{ month: "2026-09", ventas: 3, monto: 0 }, { month: "2026-08", ventas: 1, monto: 0 }] });
    const c = oct.cumplimiento;
    expect(c.ventas).toBe(4); // 1 de octubre + 3 de cosecha; la 100 no se repite
    expect(c.cosecha).toEqual({ valor: 3, operaciones: 3, porMes: [{ month: "2026-09", valor: 2, operaciones: 2 }, { month: "2026-08", valor: 1, operaciones: 1 }] });
    expect(c.yaContadas).toEqual({ valor: 1, operaciones: 1 });
    expect(c.porAgente.find((r) => r.agent === "Luis")?.ventas).toBe(1);
    // Septiembre no cambia por la sábana de octubre.
    const sep = (await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis as CampaignAnalysis;
    expect(sep.cumplimiento.yaContadas.operaciones).toBe(0);
    expect(sep.cumplimiento.ventas).toBe(a.cumplimiento.ventas);
  });
});

describe("homologación de agentes", () => {
  it("une los nombres escritos distinto en la sábana, VICI y el CRM, sin que nadie los corrija", async () => {
    const S = (niu: string, executive: string) => ({ niu, saleDate: "2026-09-10", executive, statusRaw: "APLICADA" });
    await load("cdc:sabana", "2026-09", [S("1", "MARIA JOSE LOPEZ RIVERA"), S("2", "MARIA JOSE LOPEZ RIVERA"), S("3", "JOSE MARTINES"), S("4", "O'BRIEN KARLA")]);
    await load("cdc:tipif", "2026-09", [
      { niu: "1", agent: "María López", calledAt: "2026-09-01T09:00:00", category: "Contacto efectivo positivo", tipologia: "Venta realizada" },
      { niu: "3", agent: "José Martínez", calledAt: "2026-09-01T10:00:00", category: "Contacto efectivo positivo", tipologia: "Venta realizada" },
      { niu: "5", agent: "jose martinez", calledAt: "2026-09-02T10:00:00", category: "No contacto", tipologia: "No contesta" },
      { niu: "6", agent: "Karla O'Brien", calledAt: "2026-09-02T11:00:00", category: "No contacto", tipologia: "No contesta" },
    ]);
    const r = await call("GET", "/analisis/cdc?mes=2026-09");
    expect(r.status, String(r.data.error)).toBe(200);
    const x = r.data.analysis as CampaignAnalysis;
    expect(x.agentes).toEqual(["José Martínez", "Karla O'Brien", "María Jose López Rivera"]);
    expect(x.ventas!.porEjecutivo.map((e) => [e.agent, e.ventas]).sort((p, q) => q[1] - p[1] || String(p[0]).localeCompare(String(q[0])))).toEqual([
      ["María Jose López Rivera", 2],
      ["José Martínez", 1],
      ["Karla O'Brien", 1],
    ] as [string, number][]);
    expect(x.llamadas!.porAgente.find((a) => a.agent === "José Martínez")?.llamadas).toBe(2);
    expect([...x.agentesUnidos.find((g) => g.nombre === "José Martínez")!.variantes].sort()).toEqual(["JOSE MARTINES", "José Martínez", "jose martinez"].sort());

    // El filtro y el detalle usan el nombre homologado.
    const f = (await call("GET", "/analisis/cdc?mes=2026-09&agente=" + encodeURIComponent("José Martínez"))).data.analysis as CampaignAnalysis;
    expect(f.ventas!.total).toBe(1);
    expect(f.llamadas!.total).toBe(2);
    const d = await call("GET", "/analisis/cdc/detalle?fuente=llamadas&mes=2026-09&agente=" + encodeURIComponent("José Martínez"));
    expect(d.data.total).toBe(2);
  });
});


describe("seguimiento del cliente", () => {
  it("el detalle trae nombre y teléfono (de la sábana o de la base) y la ficha junta todo", async () => {
    await load("upin:sabana", "2026-09", [{ niu: "555", saleDate: "2026-09-03", executive: "ANA RIVERA", statusRaw: "APLICADO", process: "INCREMENTO", extra: { Nombre: "Ana Pérez", Limite: 1500 } }]);
    await load("upin:base", "2026-09", [{ niu: "555", profile: "Premium", offer: "Incremento", extra: { NombreSociedad: "ANA PEREZ", TelNotificaciones: "7777-0000", Correo: "ana@correo.com", Municipio: "San Salvador" } }]);
    await load("upin:tipif", "2026-09", [{ niu: "555", agent: "Ana Rivera", calledAt: "2026-09-02T10:00:00", category: "Contacto efectivo positivo", tipologia: "Venta realizada" }]);

    const d = await call("GET", "/analisis/upin/detalle?fuente=ventas&mes=2026-09");
    expect(d.status, String(d.data.error)).toBe(200);
    expect((d.data.columns as { key: string }[]).map((c) => c.key).slice(0, 3)).toEqual(["niu", "cliente", "telefono"]);
    expect((d.data.rows as Record<string, unknown>[])[0]).toMatchObject({ niu: "555", cliente: "Ana Pérez", telefono: "7777-0000", correo: "ana@correo.com" });

    const f = await call("GET", "/clientes/555");
    expect(f.status, String(f.data.error)).toBe(200);
    expect(f.data.contacto).toMatchObject({ nombre: "Ana Pérez", telefono: "7777-0000", correo: "ana@correo.com", municipio: "San Salvador" });
    const c = (f.data.campanas as { campaign: string; ventas: { estatus: string; extra: Record<string, unknown> }[]; bases: unknown[]; llamadas: { agente: string }[] }[]).find((x) => x.campaign === "upin")!;
    expect(c.ventas[0]).toMatchObject({ estatus: "APLICADO", extra: { Nombre: "Ana Pérez", Limite: 1500 } });
    expect(c.bases).toHaveLength(1);
    expect(c.llamadas[0]!.agente).toBe("Ana Rivera");
    expect((await call("GET", "/clientes/12a")).status).toBe(400);
    // Pegado con ceros a la izquierda o espacios: es el mismo cliente; dice con qué sábana está al día.
    const pegado = await call("GET", "/clientes/" + encodeURIComponent(" 000 555 "));
    expect(pegado.data.niu).toBe("555");
    expect((pegado.data.campanas as { campaign: string; sabana: { month: string } | null }[]).find((x) => x.campaign === "upin")?.sabana?.month).toBe("2026-09");
    expect(((await call("GET", "/clientes/999999")).data.campanas as unknown[]).length).toBe(0);
  });

  it("busca por nombre (sin importar acentos ni mayúsculas) o por teléfono (con guion, espacios o el 503), y un número también como NIU", async () => {
    await load("domi:base:domi", "2026-09", [
      { niu: "180186209", profile: "P1", offer: "2", extra: { Nombre: "JOSÉ ANTONIO NÚÑEZ ROSALES", TelNotificaciones: "7406-5924" } },
      { niu: "180186210", profile: "P1", offer: "1", extra: { Nombre: "ANTONIA NUNEZ", TelNotificaciones: "2222-3333" } },
      { niu: "180186211", profile: "P2", offer: "1", extra: { Nombre: "MARIA LOPEZ", Direccion: "COLONIA JOSE NUNEZ", TelNotificaciones: "6000-1111" } },
    ]);
    const buscar = async (q: string) => (await call("GET", "/clientes/buscar?q=" + encodeURIComponent(q))).data as { tipo: string; resultados: { niu: string; nombre: string; por: string; campanas: string[] }[] };
    expect((await buscar("jose nunez")).resultados.map((r) => r.niu)).toEqual(["180186209"]); // la dirección "Colonia José Núñez" no cuenta
    expect((await buscar("Núñez")).resultados.map((r) => r.niu).sort()).toEqual(["180186209", "180186210"]);
    expect((await buscar("ana perez")).resultados).toMatchObject([{ niu: "555" }]); // también está en el CRM de TDC
    for (const tel of ["7406-5924", "(503) 7406 5924", "74065924"]) {
      expect((await buscar(tel)).resultados).toMatchObject([{ niu: "180186209", por: "telefono", nombre: "JOSÉ ANTONIO NÚÑEZ ROSALES", campanas: ["domi"] }]);
    }
    expect((await buscar("180186211")).resultados).toMatchObject([{ niu: "180186211", por: "niu" }]);
    expect((await buscar("7999-9999")).resultados).toEqual([]);
    // DUI con o sin guion, y sin el cero de adelante (en la base viene "01234567-8"; en otra, "098765432").
    await load("seguros:base", "2026-09", [
      { niu: "300100", profile: "P1", offer: "A", extra: { Nombre: "CARLA DIAZ", Dui: "01234567-8" } },
      { niu: "300101", profile: "P1", offer: "A", extra: { Nombre: "LUIS RAMOS", Dui: "098765432", Edad: 12345678 } },
    ]);
    for (const q of ["01234567-8", "012345678", "1234567-8"]) expect((await buscar(q)).resultados).toMatchObject([{ niu: "300100", por: "dui", nombre: "CARLA DIAZ" }]);
    expect((await buscar("09876543-2")).resultados).toMatchObject([{ niu: "300101", por: "dui" }]);
    // Un número que solo aparece en otra columna (no es su DUI ni su teléfono) no trae a nadie.
    expect((await buscar("1234-5678")).resultados.some((r) => r.niu === "300101")).toBe(false);
    expect((await call("GET", "/clientes/buscar?q=jo")).status).toBe(400);
  });
});
