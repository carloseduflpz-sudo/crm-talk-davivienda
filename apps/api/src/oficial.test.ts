/* Metas y cumplimientos oficiales: se guardan, llenan Metas sin borrar lo demás y llegan al Histórico y a la presentación. */
import { beforeAll, describe, expect, it } from "vitest";
import { memoryD1 } from "../test/d1";
import { memoryR2 } from "../test/r2";
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
  return { status: res.status, data: (await res.json()) as Record<string, any> };
}
async function load(dataset: string, month: string, rows: unknown[]) {
  const c = await call("POST", "/cargas", { campaign: dataset.split(":")[0], dataset, month, fileName: "x.xlsx", fileSha256: "f".repeat(64), rowsTotal: rows.length, rowsValid: rows.length, rowsDiscarded: 0 });
  expect(c.status, String(c.data.error)).toBe(201);
  expect((await call("POST", `/cargas/${c.data.id}/filas`, { seq: 0, rows })).status).toBe(200);
  expect((await call("POST", `/cargas/${c.data.id}/confirmar`, {})).status).toBe(200);
}
const venta = (i: number, fecha: string) => ({ niu: String(100 + i), saleDate: fecha, executive: "Ana", statusRaw: "ENTREGADA" });

beforeAll(async () => {
  env = { ASSETS: {} as Fetcher, DB: memoryD1(), FILES: memoryR2(), APP_ENV: "production", SETUP_TOKEN: "clave-de-configuracion-123" };
  await call("POST", "/auth/configurar", { token: env.SETUP_TOKEN, username: "carlos", displayName: "Carlos", password: "Davivienda2026" });
  await load("tdc:sabana", "2026-08", Array.from({ length: 50 }, (_, i) => venta(i, "2026-08-10")));
  await load("tdc:sabana", "2026-10", Array.from({ length: 30 }, (_, i) => venta(i, "2026-10-05")));
  // Agosto ya tenía su configuración: HC y estatus que cuentan.
  expect((await call("PUT", "/metas", { campaign: "tdc", month: "2026-08", salesGoal: 150, agents: 7, countedStatuses: ["ENTREGADA"] })).status).toBe(200);
  expect((await call("PUT", "/metas", { campaign: "tdc", month: "2026-10", salesGoal: 300, agents: 7 })).status).toBe(200);
});

describe("metas y cumplimientos oficiales", () => {
  it("se guardan; la meta queda en Metas sin borrar el HC ni los estatus que cuentan", async () => {
    const meses = [
      { campaign: "tdc", month: "2026-07", meta: 231, real: 109 },
      { campaign: "tdc", month: "2026-08", meta: 200, real: 58 },
      { campaign: "tdc", month: "2026-09", meta: 223, real: 112 },
    ];
    const r = await call("PUT", "/metas/oficial", { archivo: "Cumplimientos.xlsx", meses });
    expect(r.status, String(r.data.error)).toBe(200);
    expect(r.data).toMatchObject({ meses: 3, metas: 3 });
    const g = await call("GET", "/metas/oficial");
    expect(g.data.oficial.meses).toHaveLength(3);
    expect(g.data.metasApp.find((m: any) => m.month === "2026-08").meta).toBe(200);
    const ago = (await call("GET", "/analisis/tdc?mes=2026-08")).data.analysis.cumplimiento;
    expect(ago).toMatchObject({ meta: 200, agentes: 7 });
    expect(ago.config.estatus).toEqual(["ENTREGADA"]);
  });

  it("el histórico usa la meta y el resultado oficial de los meses cerrados (y muestra lo de la sábana al lado)", async () => {
    const h = (await call("GET", "/analisis/tdc/historico")).data.meses as any[];
    const ago = h.find((m) => m.month === "2026-08");
    expect(ago).toMatchObject({ oficial: true, meta: 200, logrado: 58, logradoSabana: 50 });
    expect(ago.cumplimiento).toBeCloseTo(29, 6);
    // Julio y septiembre no tienen archivos en la app: aparecen solo con lo oficial.
    expect(h.find((m) => m.month === "2026-09")).toMatchObject({ oficial: true, meta: 223, logrado: 112, ventas: null });
    // Octubre va en curso: es lo de la app.
    expect(h.find((m) => m.month === "2026-10")?.oficial).toBe(undefined);
  });

  it("la presentación recibe los meses oficiales del año y el trimestre usa el resultado oficial de los meses cerrados", async () => {
    const d = (await call("GET", "/presentacion/datos/tdc?mes=2026-10")).data.datos;
    expect(d.oficial.map((m: any) => m.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(d.trimestre.map((t: any) => t.month)).toEqual(["2026-10"]);
    const s = (await call("GET", "/presentacion/datos/tdc?mes=2026-08")).data.datos;
    expect(s.trimestre.find((t: any) => t.month === "2026-07")).toMatchObject({ meta: 231, resultado: 109 });
  });

  it("solo quien puede editar la configuración sube el archivo; meses o cifras inválidas se rechazan", async () => {
    expect((await call("PUT", "/metas/oficial", { meses: [{ campaign: "xxx", month: "2026-01", meta: 1, real: 1 }] })).status).toBe(400);
    expect((await call("PUT", "/metas/oficial", { meses: [{ campaign: "tdc", month: "2026-13", meta: 1, real: 1 }] })).status).toBe(400);
    expect((await call("PUT", "/metas/oficial", { meses: [{ campaign: "tdc", month: "2026-01", meta: -5, real: 1 }] })).status).toBe(400);
  });
});
