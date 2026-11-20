/* Comentarios de la sábana en la lista de clientes y en la ficha, por campaña. */
import { beforeAll, describe, expect, it } from "vitest";
import { memoryD1 } from "../test/d1";
import { createApp } from "./app";
import { SESSION_COOKIE } from "./auth";
import type { Env } from "./env";

const app = createApp();
let env: Env;
let cookie = "";
let revisiones = 0;

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
  const c = await call("POST", "/cargas", { campaign: dataset.split(":")[0], dataset, month, fileName: `${dataset}.xlsx`, fileSha256: "d".repeat(64), rowsTotal: rows.length, rowsValid: rows.length, rowsDiscarded: 0 });
  expect(c.status, String(c.data.error)).toBe(201);
  expect((await call("POST", `/cargas/${c.data.id}/filas`, { seq: 0, rows })).status).toBe(200);
  expect((await call("POST", `/cargas/${c.data.id}/confirmar`, {})).status).toBe(200);
}

beforeAll(async () => {
  env = { ASSETS: {} as Fetcher, DB: memoryD1(), FILES: { head: async () => null, put: async () => null, get: async () => null } as unknown as R2Bucket, APP_ENV: "production", SETUP_TOKEN: "clave-de-configuracion-123" };
  await call("POST", "/auth/configurar", { token: env.SETUP_TOKEN, username: "carlos", displayName: "Carlos", password: "Davivienda2026" });
  await load("upin:sabana", "2026-11", [
    { niu: "11", saleDate: "2026-11-03", executive: "Ana", statusRaw: "PENDIENTE EVALUACIÓN", reason: "CLIENTE DEBE PRESENTARSE A MH", amount: 4050, process: "UPGRADE", extra: {} },
    { niu: "12", saleDate: "2026-11-04", executive: "Ana", statusRaw: "DEVOLUCION", reason: null, amount: 3450, process: "INCREMENTO", extra: { Comentarios: "CLIENTE NO LOCALIZABLE (NO REPONDE LLAMADAS)" } },
  ]);
  await load("tdc:sabana", "2026-11", [
    { niu: "21", saleDate: "2026-11-05", executive: "Luis", statusRaw: "DEVOLUCION", reason: "SIN CAPACIDAD", extra: { "MOTIVO DEVOLUCION/OBSERVACIONES EXTRARREQUISITO/COMENTARIO GENERAL": "CLIENTE NO SE ENCONTRABA", "DETALLE DE LA DEVOLUCIÓN": "NO LLEGÓ AL TRABAJO" } },
  ]);
  await load("cdc:sabana", "2026-11", [{ niu: "31", saleDate: "2026-11-06", executive: "Eva", statusRaw: "PENDIENTE", reason: "FALTA CONSTANCIA", amount: 1000, extra: {} }]);
});

const detalle = async (camp: string) => (await call("GET", `/analisis/${camp}/detalle?fuente=ventas&mes=2026-11`)).data as { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] };

describe("comentarios de la sábana", () => {
  it("UPIN: el motivo de lo pendiente y los comentarios salen en la lista", async () => {
    const d = await detalle("upin");
    expect(d.columns.map((c) => c.label)).toEqual(expect.arrayContaining(["Estatus del banco", "Motivo", "Comentarios"]));
    const fila = (niu: string) => d.rows.find((r) => r.niu === niu)!;
    expect(fila("11")).toMatchObject({ status_raw: "PENDIENTE EVALUACIÓN", reason: "CLIENTE DEBE PRESENTARSE A MH", comentarios: null });
    expect(fila("12")).toMatchObject({ comentarios: "CLIENTE NO LOCALIZABLE (NO REPONDE LLAMADAS)" });
  });

  it("TDC: comentario general y detalle de la devolución; el motivo es el rechazo homologado", async () => {
    const d = await detalle("tdc");
    expect(d.rows[0]).toMatchObject({ reason: "SIN CAPACIDAD", comentarios: "CLIENTE NO SE ENCONTRABA · NO LLEGÓ AL TRABAJO" });
  });

  it("CDC: la columna del motivo se llama Comentarios y no se repite", async () => {
    const d = await detalle("cdc");
    const labels = d.columns.map((c) => c.label);
    expect(labels.filter((l) => l === "Comentarios")).toHaveLength(1);
    expect(labels).not.toContain("Motivo");
    expect(d.rows[0]).toMatchObject({ reason: "FALTA CONSTANCIA" });
  });

  it("la ficha del cliente trae el motivo y los comentarios", async () => {
    const f = (await call("GET", "/clientes/12")).data as { campanas: { campaign: string; ventas: Record<string, unknown>[] }[] };
    expect(f.campanas[0]!.ventas[0]).toMatchObject({ comentarios: "CLIENTE NO LOCALIZABLE (NO REPONDE LLAMADAS)", motivoEsComentario: false });
    const c = (await call("GET", "/clientes/31")).data as { campanas: { ventas: Record<string, unknown>[] }[] };
    expect(c.campanas[0]!.ventas[0]).toMatchObject({ motivo: "FALTA CONSTANCIA", motivoEsComentario: true });
  });
});
