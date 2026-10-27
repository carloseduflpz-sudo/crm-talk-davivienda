/* Resultados guardados: salen al instante la segunda vez y nunca se muestran después de un cambio. */
import { beforeAll, describe, expect, it } from "vitest";
import { memoryD1 } from "../test/d1";
import { memoryR2 } from "../test/r2";
import { createApp } from "./app";
import { SESSION_COOKIE } from "./auth";
import type { Env } from "./env";

const app = createApp();
let env: Env;
let cookie = "";
let consultas = 0;

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
  const c = await call("POST", "/cargas", { campaign: dataset.split(":")[0], dataset, month, fileName: "x.xlsx", fileSha256: "d".repeat(64), rowsTotal: rows.length, rowsValid: rows.length, rowsDiscarded: 0 });
  expect(c.status, String(c.data.error)).toBe(201);
  expect((await call("POST", `/cargas/${c.data.id}/filas`, { seq: 0, rows })).status).toBe(200);
  expect((await call("POST", `/cargas/${c.data.id}/confirmar`, {})).status).toBe(200);
}

const venta = (i: number, estatus = "ENTREGADA") => ({ niu: String(100 + i), saleDate: `2026-09-${String(1 + (i % 9)).padStart(2, "0")}`, executive: i % 2 ? "Ana" : "Luis", statusRaw: estatus });

/** Consultas a la base que hace una petición. */
async function contando<T>(f: () => Promise<T>): Promise<[T, number]> {
  const antes = consultas;
  const r = await f();
  return [r, consultas - antes];
}

beforeAll(async () => {
  const db = memoryD1();
  const prepare = db.prepare.bind(db);
  (db as unknown as { prepare: (sql: string) => D1PreparedStatement }).prepare = (sql: string) => (consultas++, prepare(sql));
  env = { ASSETS: {} as Fetcher, DB: db, FILES: memoryR2(), APP_ENV: "production", SETUP_TOKEN: "clave-de-configuracion-123" };
  await call("POST", "/auth/configurar", { token: env.SETUP_TOKEN, username: "carlos", displayName: "Carlos", password: "Davivienda2026" });
  await load("tdc:sabana", "2026-09", Array.from({ length: 10 }, (_, i) => venta(i)));
  expect((await call("PUT", "/metas", { campaign: "tdc", month: "2026-09", salesGoal: 40, agents: 2 })).status).toBe(200);
});

describe("resultados guardados", () => {
  it("la segunda vez el análisis sale de lo guardado (solo se consulta la sesión)", async () => {
    const [a, n1] = await contando(() => call("GET", "/analisis/tdc?mes=2026-09"));
    expect(a.status).toBe(200);
    expect(n1).toBeGreaterThan(5);
    const [b, n2] = await contando(() => call("GET", "/analisis/tdc?mes=2026-09"));
    expect(n2).toBe(1);
    expect(b.data.analysis).toEqual(a.data.analysis);
  });

  it("cambiar la meta se ve en seguida", async () => {
    expect((await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis.cumplimiento.meta).toBe(40);
    expect((await call("PUT", "/metas", { campaign: "tdc", month: "2026-09", salesGoal: 55, agents: 2 })).status).toBe(200);
    expect((await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis.cumplimiento.meta).toBe(55);
  });

  it("una sábana nueva se ve en seguida (también en la presentación)", async () => {
    expect((await call("GET", "/analisis/tdc")).data.analysis.ventas.total).toBe(10);
    expect((await call("GET", "/presentacion/datos/tdc?mes=2026-09")).data.datos.resultado).toBe(10);
    await load("tdc:sabana", "2026-09", Array.from({ length: 14 }, (_, i) => venta(i)));
    expect((await call("GET", "/analisis/tdc")).data.analysis.ventas.total).toBe(14);
    expect((await call("GET", "/presentacion/datos/tdc?mes=2026-09")).data.datos.resultado).toBe(14);
  });

  it("los lotes de filas de una carga sin confirmar no borran lo guardado", async () => {
    await call("GET", "/analisis/tdc?mes=2026-09");
    const c = await call("POST", "/cargas", { campaign: "tdc", dataset: "tdc:sabana", month: "2026-09", fileName: "x.xlsx", fileSha256: "e".repeat(64), rowsTotal: 1, rowsValid: 1, rowsDiscarded: 0 });
    await call("GET", "/analisis/tdc?mes=2026-09"); // crear la carga sí cambia la revisión
    expect((await call("POST", `/cargas/${c.data.id}/filas`, { seq: 0, rows: [venta(1)] })).status).toBe(200);
    const [, n] = await contando(() => call("GET", "/analisis/tdc?mes=2026-09"));
    expect(n).toBe(1);
    await call("POST", `/cargas/${c.data.id}/descartar`, {});
  });

  it("cada agente y cada mes se guardan por separado", async () => {
    const todos = (await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis;
    const ana = (await call("GET", "/analisis/tdc?mes=2026-09&agente=Ana")).data.analysis;
    expect(ana.agente).toBe("Ana");
    expect(ana.ventas.total > 0 && ana.ventas.total < todos.ventas.total).toBe(true);
    expect((await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis.ventas.total).toBe(todos.ventas.total);
  });

  it("una publicación nueva del código recalcula todo", async () => {
    await call("GET", "/analisis/tdc?mes=2026-09");
    env.CF_VERSION_METADATA = { id: "otra-publicacion" };
    const [, n] = await contando(() => call("GET", "/analisis/tdc?mes=2026-09"));
    expect(n).toBeGreaterThan(5);
    const [, n2] = await contando(() => call("GET", "/analisis/tdc?mes=2026-09"));
    expect(n2).toBe(1);
  });

  it("sin R2 se calcula igual", async () => {
    const files = env.FILES;
    env.FILES = { head: async () => null } as unknown as R2Bucket;
    try {
      const r = await call("GET", "/analisis/tdc?mes=2026-09");
      expect(r.status).toBe(200);
      expect(r.data.analysis.ventas.total).toBe(14);
    } finally {
      env.FILES = files;
    }
  });
});
