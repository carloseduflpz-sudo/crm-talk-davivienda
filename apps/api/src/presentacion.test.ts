/* Cifras de la presentación calculadas en la base, comparadas con un conteo hecho a mano. */
import type { PresentacionCampania } from "@crm/core";
import { beforeAll, describe, expect, it } from "vitest";
import { memoryD1 } from "../test/d1";
import { createApp } from "./app";
import { SESSION_COOKIE } from "./auth";
import type { Env } from "./env";

const app = createApp();
let env: Env;
let cookie = "";
const store = new Map<string, { body: ArrayBuffer; meta: Record<string, string> }>();

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const raw = body instanceof Uint8Array;
  const res = await app.handle(
    new Request("https://crm.test/api" + path, {
      method,
      headers: { cookie: `${SESSION_COOKIE}=${cookie}`, ...(body === undefined || raw ? {} : { "content-type": "application/json" }), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    }),
    env,
    () => {},
  );
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1] ?? "";
  const type = res.headers.get("content-type") ?? "";
  return { status: res.status, data: (type.includes("presentation") ? { bytes: new Uint8Array(await res.arrayBuffer()) } : await res.json()) as Record<string, unknown> };
}

async function load(dataset: string, month: string, rows: unknown[]) {
  const c = await call("POST", "/cargas", { campaign: dataset.split(":")[0], dataset, month, fileName: "x.xlsx", fileSha256: "d".repeat(64), rowsTotal: rows.length, rowsValid: rows.length, rowsDiscarded: 0 });
  expect(c.status, String(c.data.error)).toBe(201);
  expect((await call("POST", `/cargas/${c.data.id}/filas`, { seq: 0, rows })).status).toBe(200);
  expect((await call("POST", `/cargas/${c.data.id}/confirmar`, {})).status).toBe(200);
}

const sale = (niu: string, saleDate: string, statusRaw: string, extra: Record<string, string> = {}) => ({ niu, saleDate, executive: niu === "101" ? "Luis" : "Ana", statusRaw, extra });
const call_ = (niu: string, calledAt: string, category: string, tipologia: string, sub = tipologia) => ({ niu, agent: "Ana", calledAt, category, tipologia, extra: { Subtipologia: sub } });

let d: PresentacionCampania;
beforeAll(async () => {
  env = {
    ASSETS: {} as Fetcher,
    DB: memoryD1(),
    FILES: {
      head: async (k: string) => (store.has(k) ? { size: store.get(k)!.body.byteLength, customMetadata: store.get(k)!.meta } : null),
      get: async (k: string) => (store.has(k) ? { body: store.get(k)!.body } : null),
      put: async (k: string, body: ArrayBuffer, o: { customMetadata: Record<string, string> }) => void store.set(k, { body, meta: o.customMetadata }),
    } as unknown as R2Bucket,
    APP_ENV: "production",
    SETUP_TOKEN: "clave-de-configuracion-123",
  };
  await call("POST", "/auth/configurar", { token: env.SETUP_TOKEN, username: "carlos", displayName: "Carlos", password: "Davivienda2026" });
  // Septiembre: la venta del 500 ya contó; la del 501 seguía pendiente.
  await load("tdc:sabana", "2026-09", [sale("500", "2026-09-20", "ENTREGADA"), sale("501", "2026-09-25", "PENDIENTE POR REQUISITO")]);
  await load("tdc:base:primeras", "2026-09", Array.from({ length: 12 }, (_, i) => ({ niu: String(300 + i) })));
  // Octubre
  await load("tdc:sabana", "2026-10", [
    sale("500", "2026-09-20", "ENTREGADA"), // ya contó en septiembre
    sale("501", "2026-09-25", "ENTREGADA"), // cosecha
    sale("502", "2026-09-28", "RECHAZADA"), // cosecha que no cuenta
    sale("100", "2026-10-02", "ENTREGADA", { "PRI - SEG / CUENTA": "SEGUNDA CUENTA" }), // la sábana dice que es de segundas
    sale("101", "2026-10-06", "ENTREGADA"),
    sale("102", "2026-10-07", "PENDIENTE POR REQUISITO"),
  ]);
  await load("tdc:base:primeras", "2026-10", Array.from({ length: 10 }, (_, i) => ({ niu: String(100 + i) })));
  await load("tdc:base:segundas", "2026-10", Array.from({ length: 5 }, (_, i) => ({ niu: String(200 + i) })));
  await load("tdc:tipif", "2026-10", [
    call_("101", "2026-10-01T09:00:00", "No contacto", "No contesta"),
    call_("101", "2026-10-06T09:00:00", "Contacto efectivo positivo", "Venta realizada"),
    call_("102", "2026-10-03T09:00:00", "Contacto efectivo", "No interesa producto", "No quiere mas tdc"),
    call_("104", "2026-10-03T10:00:00", "Contacto efectivo", "No interesa producto", "Solo utiliza efectivo"),
    call_("200", "2026-10-03T11:00:00", "No contacto", "No contesta"),
  ]);
  expect((await call("PUT", "/metas", { campaign: "tdc", month: "2026-10", salesGoal: 20, agents: 2 })).status).toBe(200);
  const r = await call("GET", "/presentacion/datos/tdc?mes=2026-10");
  expect(r.status, String(r.data.error)).toBe(200);
  d = r.data.datos as PresentacionCampania;
});

describe("presentación: cifras de TDC octubre", () => {
  it("cada base: únicos, recorridos, contactados, un intento, con venta y la del mes anterior", () => {
    const [pri, seg] = d.bases;
    expect(pri).toMatchObject({ dataset: "tdc:base:primeras", unicos: 10, recorridos: 3, llamadas: 4, unIntento: 2, contactados: 3, conVenta: 3, mesAnterior: 12 });
    expect(seg).toMatchObject({ dataset: "tdc:base:segundas", unicos: 5, recorridos: 1, contactados: 0, conVenta: 0, mesAnterior: null });
    // Categoría de la última llamada de cada cliente.
    expect([...pri!.contacto].sort((a, b) => a.label.localeCompare(b.label))).toEqual([
      { label: "Contacto efectivo", n: 2 },
      { label: "Contacto efectivo positivo", n: 1 },
    ]);
  });

  it("sábana: mes y cosecha, si cuenta, ya contadas y a qué base va cada venta", () => {
    const pick = (niu: string) => d.ventas.find((v) => v.nius.includes(niu))!;
    expect(pick("500")).toMatchObject({ origen: "cosecha", k: 2 });
    expect(pick("501")).toMatchObject({ origen: "cosecha", k: 1, semana: null });
    expect(pick("502")).toMatchObject({ origen: "cosecha", k: 0 });
    expect(pick("100")).toMatchObject({ origen: "mes", k: 1, grupo: "tdc:base:segundas", semana: 1 });
    expect(pick("101")).toMatchObject({ origen: "mes", k: 1, grupo: "tdc:base:primeras", semana: 2 });
    expect(pick("102")).toMatchObject({ origen: "mes", k: 0, grupo: "tdc:base:primeras" });
    expect(d.resultado).toBe(3);
    expect(d.meta).toBe(20);
  });

  it("motivos: subtipologías de cada tipología (sin no contacto ni ventas)", () => {
    expect([...d.motivos].sort((a, b) => a.subtipologia.localeCompare(b.subtipologia))).toEqual([
      { tipologia: "No interesa producto", subtipologia: "No quiere mas tdc", n: 1 },
      { tipologia: "No interesa producto", subtipologia: "Solo utiliza efectivo", n: 1 },
    ]);
  });

  it("trimestre: meta por agente y ventas que cuentan de cada agente", () => {
    expect(d.trimestre).toHaveLength(1);
    expect(d.trimestre[0]).toMatchObject({ month: "2026-10", meta: 20, metaPorAgente: 10, resultado: 3 });
    expect([...d.trimestre[0]!.porAgente].sort((a, b) => a.agent.localeCompare(b.agent))).toEqual([
      { agent: "Ana", ventas: 2 },
      { agent: "Luis", ventas: 1 },
    ]);
  });

  it("guarda la plantilla y la devuelve con su mes", async () => {
    expect((await call("GET", "/presentacion/plantilla")).data.plantilla).toBeNull();
    const pptx = new Uint8Array(200);
    pptx.set([0x50, 0x4b, 3, 4]);
    expect((await call("PUT", "/presentacion/plantilla", pptx, { "x-crm-archivo": "1", "x-mes": "2026-10", "x-nombre": encodeURIComponent("ppt w4 octubre.pptx") })).status).toBe(200);
    const meta = (await call("GET", "/presentacion/plantilla")).data.plantilla as Record<string, unknown>;
    expect(meta).toMatchObject({ nombre: "ppt w4 octubre.pptx", mes: "2026-10", origen: "subida", por: "carlos", bytes: 200 });
    const file = await call("GET", "/presentacion/plantilla/archivo");
    expect((file.data.bytes as Uint8Array).length).toBe(200);
    expect((await call("PUT", "/presentacion/plantilla", new Uint8Array(200), { "x-crm-archivo": "1" })).status).toBe(400);
  });
});
