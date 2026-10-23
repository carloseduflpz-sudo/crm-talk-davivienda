/* Centro de carga contra una base SQLite real con las migraciones del proyecto. */
import { beforeEach, describe, expect, it } from "vitest";
import { memoryD1 } from "../test/d1";
import { createApp } from "./app";
import { SESSION_COOKIE } from "./auth";
import type { Env } from "./env";

const ORIGIN = "https://crm.test";
const app = createApp();
let env: Env;
let cookie = "";
const files = new Map<string, ArrayBuffer>();

async function call(method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { cookie: `${SESSION_COOKIE}=${cookie}`, ...extraHeaders };
  let payload: BodyInit | undefined;
  if (body instanceof Uint8Array) payload = body;
  else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await app.handle(new Request(ORIGIN + "/api" + path, { method, headers, body: payload }), env, () => {});
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1] ?? "";
  const ct = res.headers.get("content-type") ?? "";
  return { status: res.status, data: ct.includes("json") ? ((await res.json()) as Record<string, unknown>) : {} };
}

const sha256 = async (bytes: Uint8Array) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
const FAKE_SHA = "a".repeat(64);

beforeEach(async () => {
  files.clear();
  env = {
    ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
    DB: memoryD1(),
    FILES: {
      head: async () => null,
      put: async (k: string, v: ArrayBuffer) => void files.set(k, v),
      get: async (k: string) => (files.has(k) ? { body: new Uint8Array(files.get(k)!), httpMetadata: {} } : null),
    } as unknown as R2Bucket,
    APP_ENV: "production",
    SETUP_TOKEN: "clave-de-configuracion-123",
  };
  cookie = "";
  await call("POST", "/auth/configurar", { token: env.SETUP_TOKEN, username: "carlos", displayName: "Carlos", password: "Davivienda2026" });
});

const saleRows = (n: number, start = 0) =>
  Array.from({ length: n }, (_, i) => ({
    niu: String(1000 + start + i),
    saleDate: "2026-09-15",
    executive: "Ana",
    statusRaw: ["Entregada", "RECHAZADA", "En análisis"][(start + i) % 3],
    reason: null,
    extra: { NOMBRE: `Cliente ${i}` },
  }));

async function upload(dataset: string, month: string, rows: unknown[], campaign = dataset.split(":")[0]) {
  const c = await call("POST", "/cargas", { campaign, dataset, month, fileName: "Reporte TDC Septiembre.xlsx", fileSha256: FAKE_SHA, rowsTotal: rows.length + 1, rowsValid: rows.length, rowsDiscarded: 1 });
  expect(c.status).toBe(201);
  const id = c.data.id as string;
  for (let i = 0, seq = 0; i < rows.length; i += 2, seq++) {
    const r = await call("POST", `/cargas/${id}/filas`, { seq, rows: rows.slice(i, i + 2) });
    expect(r.status).toBe(200);
  }
  return { id, version: c.data.version as number };
}

describe("centro de carga", () => {
  it("guarda una sábana por lotes, la clasifica y la deja vigente", async () => {
    const { id, version } = await upload("tdc:sabana", "2026-09", saleRows(5));
    expect(version).toBe(1);
    const ok = await call("POST", `/cargas/${id}/confirmar`, {});
    expect(ok.status).toBe(200);
    expect(ok.data.upload).toMatchObject({ isCurrent: true, status: "vigente", rowsValid: 5 });

    const { results } = await env.DB.prepare("SELECT niu, status_class, extra FROM bank_sales ORDER BY niu").all<{ niu: string; status_class: string; extra: string }>();
    expect(results.map((r) => r.status_class)).toEqual(["aprobado", "rechazado", "en_proceso", "aprobado", "rechazado"]);
    expect(JSON.parse(results[0]!.extra)).toEqual({ NOMBRE: "Cliente 0" });
  });

  it("un lote reenviado no se duplica y un lote salteado se rechaza", async () => {
    const c = await call("POST", "/cargas", { campaign: "tdc", dataset: "tdc:sabana", month: "2026-09", fileName: "a.xlsx", fileSha256: FAKE_SHA, rowsTotal: 4, rowsValid: 4, rowsDiscarded: 0 });
    const id = c.data.id as string;
    expect((await call("POST", `/cargas/${id}/filas`, { seq: 0, rows: saleRows(2) })).status).toBe(200);
    expect((await call("POST", `/cargas/${id}/filas`, { seq: 0, rows: saleRows(2) })).data).toMatchObject({ duplicate: true });
    expect((await call("POST", `/cargas/${id}/filas`, { seq: 2, rows: saleRows(2, 2) })).status).toBe(409);
    expect((await call("POST", `/cargas/${id}/filas`, { seq: 1, rows: saleRows(2, 2) })).status).toBe(200);
    expect((await call("POST", `/cargas/${id}/confirmar`, {})).status).toBe(200);
  });

  it("no activa una carga incompleta", async () => {
    const c = await call("POST", "/cargas", { campaign: "tdc", dataset: "tdc:sabana", month: "2026-09", fileName: "a.xlsx", fileSha256: FAKE_SHA, rowsTotal: 10, rowsValid: 10, rowsDiscarded: 0 });
    const id = c.data.id as string;
    await call("POST", `/cargas/${id}/filas`, { seq: 0, rows: saleRows(4) });
    const r = await call("POST", `/cargas/${id}/confirmar`, {});
    expect(r.status).toBe(409);
    expect(String(r.data.error)).toContain("4 de 10");
  });

  it("una versión nueva reemplaza a la anterior sin borrarla, y se puede volver atrás", async () => {
    const v1 = await upload("tdc:sabana", "2026-09", saleRows(3));
    await call("POST", `/cargas/${v1.id}/confirmar`, {});
    const v2 = await upload("tdc:sabana", "2026-09", saleRows(4));
    expect(v2.version).toBe(2);
    await call("POST", `/cargas/${v2.id}/confirmar`, {});

    const list = (await call("GET", "/cargas?campana=tdc")).data.uploads as { id: string; isCurrent: boolean; status: string }[];
    expect(list.find((u) => u.id === v1.id)).toMatchObject({ isCurrent: false, status: "reemplazada" });
    expect(list.find((u) => u.id === v2.id)).toMatchObject({ isCurrent: true, status: "vigente" });

    expect((await call("POST", `/cargas/${v1.id}/activar`, {})).status).toBe(200);
    const after = (await call("GET", "/cargas?campana=tdc")).data.uploads as { id: string; isCurrent: boolean }[];
    expect(after.find((u) => u.id === v1.id)?.isCurrent).toBe(true);
    expect(after.find((u) => u.id === v2.id)?.isCurrent).toBe(false);
  });

  it("descartar borra las filas de esa versión; la vigente no se puede descartar", async () => {
    const v1 = await upload("tdc:sabana", "2026-09", saleRows(3));
    await call("POST", `/cargas/${v1.id}/confirmar`, {});
    expect((await call("POST", `/cargas/${v1.id}/descartar`, {})).status).toBe(400);
    const v2 = await upload("tdc:sabana", "2026-09", saleRows(2));
    expect((await call("POST", `/cargas/${v2.id}/descartar`, {})).status).toBe(200);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM bank_sales").first<{ n: number }>();
    expect(n?.n).toBe(3);
  });

  it("eliminar: también la vigente; borra sus filas, su respaldo y deja de contar", async () => {
    const v1 = await upload("tdc:sabana", "2026-09", saleRows(3));
    await call("POST", `/cargas/${v1.id}/confirmar`, {});
    const v2 = await upload("tdc:sabana", "2026-09", saleRows(4, 10));
    await call("POST", `/cargas/${v2.id}/confirmar`, {});
    const del: string[] = [];
    (env.FILES as unknown as { delete: (k: string) => Promise<void> }).delete = async (k) => void del.push(k);
    await env.DB.prepare("UPDATE uploads SET file_key = 'respaldo/v2.xlsx' WHERE id = ?").bind(v2.id).run();

    expect((await call("POST", `/cargas/${v2.id}/eliminar`, {})).status).toBe(200);
    expect(del).toEqual(["respaldo/v2.xlsx"]);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM bank_sales").first<{ n: number }>();
    expect(n?.n).toBe(3); // quedan las de la versión 1
    const list = (await call("GET", "/cargas?campana=tdc")).data.uploads as { id: string; isCurrent: boolean; status: string }[];
    expect(list.find((u) => u.id === v2.id)).toBe(undefined);
    expect(list.find((u) => u.id === v1.id)).toMatchObject({ isCurrent: false, status: "reemplazada" });
    // Sin sábana vigente el mes ya no tiene ventas; la versión anterior se puede volver a activar.
    expect(((await call("GET", "/analisis/tdc?mes=2026-09")).data.analysis as { ventas: unknown }).ventas).toBeNull();
    expect((await call("POST", `/cargas/${v1.id}/activar`, {})).status).toBe(200);
    expect((await call("POST", `/cargas/${v2.id}/eliminar`, {})).status).toBe(400);
  });

  it("resumen de la sábana vigente para compararla con una nueva", async () => {
    const v1 = await upload("tdc:sabana", "2026-09", [...saleRows(3), { ...saleRows(1, 50)[0], saleDate: "2026-08-30" }]);
    await call("POST", `/cargas/${v1.id}/confirmar`, {});
    const r = await call("GET", `/cargas/${v1.id}/resumen`);
    expect(r.status, String(r.data.error)).toBe(200);
    expect(r.data).toMatchObject({ filas: 4, hasta: "2026-09-15", porMes: { "2026-09": 3, "2026-08": 1 } });
  });

  it("clasifica las llamadas de VICI con las tipologías de la campaña y acepta llamadas sin NIU", async () => {
    const rows = [
      { niu: "123", agent: "Ana", calledAt: "2026-09-10T10:00:00", category: "Contacto efectivo positivo", tipologia: "Venta realizada" },
      { niu: "", agent: "Ana", calledAt: "2026-09-10T10:05:00", category: "No contacto", tipologia: "Buzon de voz" },
      { niu: "124", agent: "Luis", calledAt: "2026-09-10T10:06:00", category: "Contacto efectivo negativo", tipologia: "Tipología nueva" },
    ];
    const { id } = await upload("tdc:tipif", "2026-09", rows);
    expect((await call("POST", `/cargas/${id}/confirmar`, {})).status).toBe(200);
    const { results } = await env.DB.prepare("SELECT niu, call_class FROM calls ORDER BY called_at").all<{ niu: string; call_class: string }>();
    expect(results).toEqual([
      { niu: "123", call_class: "venta" },
      { niu: "", call_class: "no_contacto" },
      { niu: "124", call_class: "negativo" },
    ]);
  });

  it("guarda bases y ventas del CRM", async () => {
    const b = await upload("domi:base:domi", "2026-09", [{ niu: "55", profile: "P1", offer: "CAESS", extra: { Edad: 40 } }]);
    expect((await call("POST", `/cargas/${b.id}/confirmar`, {})).status).toBe(200);
    const v = await upload("upin:ventas", "2026-09", [{ niu: "77", agent: "Ana", enteredAt: "2026-09-01T08:00:00", product: "Upgrade" }]);
    expect((await call("POST", `/cargas/${v.id}/confirmar`, {})).status).toBe(200);
    expect((await env.DB.prepare("SELECT offer FROM base_records").first<{ offer: string }>())?.offer).toBe("CAESS");
    expect((await env.DB.prepare("SELECT product FROM crm_sales").first<{ product: string }>())?.product).toBe("Upgrade");
  });

  it("rechaza datos inválidos", async () => {
    const base = { campaign: "tdc", dataset: "tdc:sabana", month: "2026-09", fileName: "a.xlsx", fileSha256: FAKE_SHA, rowsTotal: 1, rowsValid: 1, rowsDiscarded: 0 };
    expect((await call("POST", "/cargas", { ...base, dataset: "upin:sabana" })).status).toBe(400);
    expect((await call("POST", "/cargas", { ...base, month: "septiembre" })).status).toBe(400);
    expect((await call("POST", "/cargas", { ...base, rowsValid: 0 })).status).toBe(400);
    const c = await call("POST", "/cargas", base);
    const bad = await call("POST", `/cargas/${c.data.id}/filas`, { seq: 0, rows: [{ niu: "ABC" }] });
    expect(bad.status).toBe(400);
  });

  it("guarda el Excel original solo si coincide con el que se leyó", async () => {
    const bytes = new TextEncoder().encode("contenido del excel");
    const c = await call("POST", "/cargas", { campaign: "tdc", dataset: "tdc:sabana", month: "2026-09", fileName: "Sábana TDC.xlsx", fileSha256: await sha256(bytes), rowsTotal: 1, rowsValid: 1, rowsDiscarded: 0 });
    const id = c.data.id as string;
    expect((await call("PUT", `/cargas/${id}/archivo`, bytes, { "content-type": "application/octet-stream" })).status).toBe(400); // falta la cabecera
    expect((await call("PUT", `/cargas/${id}/archivo`, new TextEncoder().encode("otro"), { "x-crm-archivo": "1" })).status).toBe(400);
    expect((await call("PUT", `/cargas/${id}/archivo`, bytes, { "x-crm-archivo": "1" })).status).toBe(200);
    expect([...files.keys()]).toEqual(["cargas/tdc/tdc_sabana/2026-09/v1-Sabana TDC.xlsx"]);
  });

  it("sin sesión no se puede cargar ni ver", async () => {
    cookie = "";
    expect((await call("GET", "/cargas")).status).toBe(401);
  });
});
