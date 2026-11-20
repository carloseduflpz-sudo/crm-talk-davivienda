/* Seguimiento de documentación: cola desde la sábana vigente, llamadas después de la venta y gestión. */
import { beforeAll, describe, expect, it } from "vitest";
import { memoryD1 } from "../test/d1";
import { createApp } from "./app";
import { SESSION_COOKIE } from "./auth";
import type { Env } from "./env";
import type { FilaDocumentacion } from "./seguimientoDoc";

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

const venta = (niu: string, saleDate: string, sub: string, extra: Record<string, string> = {}) => ({
  niu,
  saleDate,
  executive: "Ana",
  statusRaw: sub,
  extra: { NOMBRE: `Cliente ${niu}`, "TEL. VENTA REALIZADA": "7000" + niu, "ETAPA PRIMARIA": "6APOYO TALK AMERICAS", ...extra },
});

beforeAll(async () => {
  env = { ASSETS: {} as Fetcher, DB: memoryD1(), FILES: { head: async () => null, put: async () => void revisiones++, get: async () => null } as unknown as R2Bucket, APP_ENV: "production", SETUP_TOKEN: "clave-de-configuracion-123" };
  await call("POST", "/auth/configurar", { token: env.SETUP_TOKEN, username: "carlos", displayName: "Carlos", password: "Davivienda2026" });
  // Una sábana vieja (octubre) que ya no es la vigente más reciente.
  await load("tdc:sabana", "2026-10", [venta("999", "2026-10-02", "PENDIENTE DOCUMENTO")]);
  await load("tdc:sabana", "2026-11", [
    venta("101", "2026-11-18", "PENDIENTE DOCUMENTO", { "PENDIENTE POR REQUISITO": "BOLETAS DE PAGO", DIGITOS: "-" }),
    venta("101", "2026-11-18", "PENDIENTE DOCUMENTO", { "PENDIENTE POR REQUISITO": "BOLETAS DE PAGO", DIGITOS: "-" }), // doble TC
    venta("102", "2026-11-10", "EXTRARREQUISITO"),
    venta("103", "2026-11-05", "PENDIENTE DOCUMENTO/VENCIDO"),
    venta("201", "2026-10-16", "DEVOLUCION", { "ETAPA PRIMARIA": "2EN DISTRIBUCION", "DETALLE DE LA DEVOLUCIÓN": "no llegó al trabajo", DIGITOS: "3503" }),
    venta("202", "2026-11-04", "EN PROCESO", { "ETAPA PRIMARIA": "2EN DISTRIBUCION" }),
    venta("301", "2026-11-12", "ENTREGADA", { "ETAPA PRIMARIA": "1ENTREGADA" }),
    venta("302", "2026-11-12", "RECHAZADO", { "ETAPA PRIMARIA": "3EN PCBM" }),
    venta("303", "2026-11-12", "CREACIÓN DE EMPRESA"),
  ]);
  await load("tdc:tipif", "2026-11", [
    { niu: "101", agent: "Ana", calledAt: "2026-11-18T10:00:00", category: "No contacto", tipologia: "No contesta" }, // día de la venta
    { niu: "101", agent: "Ana", calledAt: "2026-11-19T09:00:00", category: "No contacto", tipologia: "No contesta" },
    { niu: "101", agent: "Ana", calledAt: "2026-11-19T11:00:00", category: "No contacto", tipologia: "Buzon de voz" },
    { niu: "101", agent: "Luis", calledAt: "2026-11-19T16:00:00", category: "No contacto", tipologia: "No contesta" },
    { niu: "101", agent: "Luis", calledAt: "2026-11-20T08:30:00", category: "Contacto efectivo positivo", tipologia: "Se realiza cita" },
    { niu: "201", agent: "Ana", calledAt: "2026-10-10T08:30:00", category: "No contacto", tipologia: "No contesta" }, // antes de la venta
    { niu: "201", agent: "Ana", calledAt: "2026-11-02T08:30:00", category: "No contacto", tipologia: "Buzon de voz" },
  ]);
});

const cola = async () => (await call("GET", "/seguimiento-documentacion")).data as { sabana: { month: string; corte: string }; filas: FilaDocumentacion[]; historial: Record<string, unknown>[] };

describe("seguimiento de documentación", () => {
  it("arma la cola con las subetapas de seguimiento y productivas de la sábana vigente más reciente", async () => {
    const d = await cola();
    expect(d.sabana.month).toBe("2026-11");
    expect(d.sabana.corte).toBe("2026-11-18");
    const por = (g: string) => d.filas.filter((f) => f.grupo === g).map((f) => f.niu).sort();
    expect(por("seguimiento")).toEqual(["101", "101", "102"]); // 103 está vencido: no aplica
    expect(por("productivas")).toEqual(["201", "202"]);
    const dev = d.filas.find((f) => f.niu === "201")!;
    expect(dev).toMatchObject({ nombre: "Cliente 201", telefono: "7000201", digitos: "3503", detalle: "no llegó al trabajo", etapa: "2EN DISTRIBUCION", subetapa: "DEVOLUCION" });
  });

  it("cuenta llamadas y días de gestión desde el día siguiente a la venta", async () => {
    const d = await cola();
    expect(d.filas.find((f) => f.niu === "101")).toMatchObject({ llamadas: 4, dias: 2, ultimaLlamada: "2026-11-20T08:30:00", tipificacion: "Se realiza cita" });
    expect(d.filas.find((f) => f.niu === "201")).toMatchObject({ llamadas: 1, dias: 1, tipificacion: "Buzon de voz" });
    expect(d.filas.find((f) => f.niu === "102")).toMatchObject({ llamadas: 0, dias: 0, ultimaLlamada: null });
  });

  it("guarda la gestión con STATUS homologado y comentario libre, y la más reciente queda primero", async () => {
    expect((await call("POST", "/seguimiento-documentacion/notas", { niu: "101", venta: "2026-11-18", status: "INVENTADO" })).status).toBe(400);
    expect((await call("POST", "/seguimiento-documentacion/notas", { niu: "555", venta: "2026-11-18", status: "NO CONTESTA" })).status).toBe(404);
    const a = await call("POST", "/seguimiento-documentacion/notas", { niu: "101", venta: "2026-11-18", status: "NO CONTESTA", comentario: "SE INTENTA CONTACTAR 19-11" });
    expect(a.status, String(a.data.error)).toBe(201);
    const b = await call("POST", "/seguimiento-documentacion/notas", { niu: "101", venta: "2026-11-18", status: "SE REALIZA CITA", comentario: "  RECIBIRA A MENSAJERIA   20-11 AM " });
    expect(b.status).toBe(201);
    const d = await cola();
    const f = d.filas.find((x) => x.niu === "101")!;
    expect(f.notas.map((n) => [n.status, n.comentario, n.por])).toEqual([
      ["SE REALIZA CITA", "RECIBIRA A MENSAJERIA 20-11 AM", "Carlos"],
      ["NO CONTESTA", "SE INTENTA CONTACTAR 19-11", "Carlos"],
    ]);
    expect(d.historial).toHaveLength(2);
    expect(d.historial[0]).toMatchObject({ niu: "101", nombre: "Cliente 101", subetapa: "PENDIENTE DOCUMENTO", status: "SE REALIZA CITA" });
  });

  it("registrar una gestión no cambia la revisión de las cifras", async () => {
    const antes = revisiones;
    expect((await call("POST", "/seguimiento-documentacion/notas", { niu: "201", venta: "2026-10-16", status: "VOLVER A LLAMAR" })).status).toBe(201);
    expect(revisiones).toBe(antes);
    // una carga sí la cambia
    await load("tdc:tipif", "2026-10", [{ niu: "201", agent: "Ana", calledAt: "2026-10-20T08:30:00", category: "No contacto", tipologia: "No contesta" }]);
    expect(revisiones).toBeGreaterThan(antes);
  });;

  it("solo el dueño del CRM elimina un comentario; deja de mostrarse y de descargarse", async () => {
    const d0 = await cola();
    expect((d0 as unknown as { puedeEliminar: boolean }).puedeEliminar).toBe(true);
    const nota = d0.filas.find((x) => x.niu === "101")!.notas[0]!;
    // Otro administrador no puede.
    expect((await call("POST", "/usuarios", { username: "ana", displayName: "Ana", role: "admin", password: "Davivienda2026b" })).status).toBe(201);
    const dueno = cookie;
    cookie = "";
    expect((await call("POST", "/auth/entrar", { username: "ana", password: "Davivienda2026b" })).status).toBe(200);
    if ((await call("GET", "/me")).data.mustChangePassword) {
      expect((await call("POST", "/auth/cambiar-clave", { currentPassword: "Davivienda2026b", newPassword: "OtraClave2026x" })).status).toBe(200);
    }
    expect(((await call("GET", "/seguimiento-documentacion")).data as { puedeEliminar: boolean }).puedeEliminar).toBe(false);
    expect((await call("POST", `/seguimiento-documentacion/notas/${nota.id}/eliminar`, {})).status).toBe(403);
    cookie = dueno;
    expect((await call("POST", `/seguimiento-documentacion/notas/${nota.id}/eliminar`, {})).status).toBe(200);
    expect((await call("POST", `/seguimiento-documentacion/notas/${nota.id}/eliminar`, {})).status).toBe(404);
    const d = await cola();
    expect(d.filas.find((x) => x.niu === "101")!.notas.map((n) => n.id)).not.toContain(nota.id);
    expect(d.historial.map((n) => n.id)).not.toContain(nota.id);
  });

  it("documento recibido saca la venta de la cola (y se puede desmarcar)", async () => {
    expect((await call("POST", "/seguimiento-documentacion/recibido", { niu: "102", venta: "2026-11-10" })).status).toBe(400);
    expect((await call("POST", "/seguimiento-documentacion/recibido", { niu: "777", venta: "2026-11-10", recibido: true })).status).toBe(404);
    const a = await call("POST", "/seguimiento-documentacion/recibido", { niu: "102", venta: "2026-11-10", recibido: true });
    expect(a.status).toBe(200);
    expect((await call("POST", "/seguimiento-documentacion/recibido", { niu: "102", venta: "2026-11-10", recibido: true })).status).toBe(200); // no se duplica
    let f = (await cola()).filas.find((x) => x.niu === "102")!;
    expect(f.recibido).toMatchObject({ por: "Carlos" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM doc_followup_received WHERE undone_at IS NULL").first<{ n: number }>())!.n).toBe(1);
    expect((await call("POST", "/seguimiento-documentacion/recibido", { niu: "102", venta: "2026-11-10", recibido: false })).status).toBe(200);
    f = (await cola()).filas.find((x) => x.niu === "102")!;
    expect(f.recibido).toBeNull();
    // la marca de "recibido" de la doble TC aplica a las dos tarjetas de la misma venta
    await call("POST", "/seguimiento-documentacion/recibido", { niu: "101", venta: "2026-11-18", recibido: true });
    expect((await cola()).filas.filter((x) => x.niu === "101").every((x) => x.recibido)).toBe(true);
  });
});
