/* Pruebas de la API contra una base SQLite real con las migraciones del proyecto. */
import { beforeEach, describe, expect, it } from "vitest";
import { memoryD1 } from "../test/d1";
import { createApp } from "./app";
import { SESSION_COOKIE } from "./auth";
import type { Env } from "./env";
import { hashPassword, passwordProblem, verifyPassword } from "./password";

const ORIGIN = "https://crm.test";
const SETUP_TOKEN = "clave-de-configuracion-123";
const app = createApp();

let env: Env;
beforeEach(() => {
  env = {
    ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
    DB: memoryD1(),
    FILES: { head: async () => null } as unknown as R2Bucket,
    APP_ENV: "production",
    SETUP_TOKEN,
  };
});

/** Cliente de prueba que guarda la cookie de sesión como un navegador. */
function browser() {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
      const h: Record<string, string> = { ...headers };
      if (cookie) h.cookie = `${SESSION_COOKIE}=${cookie}`;
      if (body !== undefined) h["content-type"] ??= "application/json";
      const res = await app.handle(
        new Request(ORIGIN + "/api" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }),
        env,
        () => {},
      );
      const set = res.headers.get("set-cookie");
      if (set) {
        const m = set.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
        cookie = m?.[1] ?? "";
      }
      const data = (await res.json()) as Record<string, unknown>;
      return { status: res.status, data, setCookie: set };
    },
  };
}

async function setupAdmin() {
  const b = browser();
  const r = await b.call("POST", "/auth/configurar", { token: SETUP_TOKEN, username: "Carlos", displayName: "Carlos Pérez", password: "Davivienda2026" });
  expect(r.status).toBe(201);
  return b;
}

/* ---------- contraseñas ---------- */

describe("contraseñas", () => {
  it("se guardan cifradas y se verifican", async () => {
    const h = await hashPassword("Secreta12345");
    expect(h.startsWith("pbkdf2$100000$")).toBe(true);
    expect(h.includes("Secreta12345")).toBe(false);
    expect(await verifyPassword("Secreta12345", h)).toBe(true);
    expect(await verifyPassword("secreta12345", h)).toBe(false);
  });
  it("dos cifrados de la misma contraseña son distintos (sal)", async () => {
    expect(await hashPassword("Secreta12345")).not.toBe(await hashPassword("Secreta12345"));
  });
  it("exige largo, letras y números, y que no contenga el usuario", () => {
    expect(passwordProblem("corta1", "ana")).not.toBe(null);
    expect(passwordProblem("solamenteletras", "ana")).not.toBe(null);
    expect(passwordProblem("1234567890123", "ana")).not.toBe(null);
    expect(passwordProblem("carlos2026xx", "carlos")).not.toBe(null);
    expect(passwordProblem("Davivienda2026", "carlos")).toBe(null);
  });
});

/* ---------- configuración inicial ---------- */

describe("configuración inicial", () => {
  it("al principio la app pide configurarse", async () => {
    expect((await browser().call("GET", "/auth/estado")).data).toMatchObject({ needsSetup: true });
  });

  it("rechaza una clave de configuración incorrecta", async () => {
    const r = await browser().call("POST", "/auth/configurar", { token: "otra", username: "carlos", displayName: "Carlos", password: "Davivienda2026" });
    expect(r.status).toBe(403);
  });

  it("no funciona si falta SETUP_TOKEN en Cloudflare", async () => {
    env.SETUP_TOKEN = undefined;
    const r = await browser().call("POST", "/auth/configurar", { token: "x", username: "carlos", displayName: "Carlos", password: "Davivienda2026" });
    expect(r.status).toBe(503);
  });

  it("crea el primer administrador, abre sesión y no se puede repetir", async () => {
    const b = await setupAdmin();
    expect(b.cookie.length).toBeGreaterThan(20);
    expect((await b.call("GET", "/me")).data).toMatchObject({ username: "carlos", displayName: "Carlos Pérez", role: "admin", mustChangePassword: false });
    expect((await browser().call("GET", "/auth/estado")).data).toMatchObject({ needsSetup: false });
    const again = await browser().call("POST", "/auth/configurar", { token: SETUP_TOKEN, username: "otro", displayName: "Otro", password: "Davivienda2026" });
    expect(again.status).toBe(409);
  });
});

/* ---------- entrar y salir ---------- */

describe("entrar y salir", () => {
  it("la cookie es HttpOnly, SameSite=Strict y Secure", async () => {
    await setupAdmin();
    const r = await browser().call("POST", "/auth/entrar", { username: "carlos", password: "Davivienda2026" });
    expect(r.status).toBe(200);
    expect(r.setCookie).toContain("HttpOnly");
    expect(r.setCookie).toContain("SameSite=Strict");
    expect(r.setCookie).toContain("Secure");
  });

  it("el usuario no distingue mayúsculas", async () => {
    await setupAdmin();
    expect((await browser().call("POST", "/auth/entrar", { username: "  CARLOS ", password: "Davivienda2026" })).status).toBe(200);
  });

  it("mismo mensaje si el usuario no existe o la contraseña es incorrecta", async () => {
    await setupAdmin();
    const a = await browser().call("POST", "/auth/entrar", { username: "nadie", password: "Davivienda2026" });
    const b = await browser().call("POST", "/auth/entrar", { username: "carlos", password: "Incorrecta2026" });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.data.error).toBe(b.data.error);
  });

  it("bloquea 15 minutos tras 5 intentos fallidos", async () => {
    await setupAdmin();
    for (let i = 0; i < 5; i++) expect((await browser().call("POST", "/auth/entrar", { username: "carlos", password: "Mala123456" })).status).toBe(401);
    const r = await browser().call("POST", "/auth/entrar", { username: "carlos", password: "Davivienda2026" });
    expect(r.status).toBe(429);
  });

  it("sin sesión la API no entrega datos", async () => {
    expect((await browser().call("GET", "/me")).status).toBe(401);
    expect((await browser().call("GET", "/campaigns")).status).toBe(401);
  });

  it("una cookie inventada no sirve", async () => {
    const r = await app.handle(new Request(ORIGIN + "/api/me", { headers: { cookie: `${SESSION_COOKIE}=inventada` } }), env, () => {});
    expect(r.status).toBe(401);
  });

  it("al salir, la sesión deja de servir", async () => {
    const b = await setupAdmin();
    const stolen = b.cookie;
    expect((await b.call("POST", "/auth/salir", {})).status).toBe(200);
    const r = await app.handle(new Request(ORIGIN + "/api/me", { headers: { cookie: `${SESSION_COOKIE}=${stolen}` } }), env, () => {});
    expect(r.status).toBe(401);
  });
});

/* ---------- protección contra otros sitios ---------- */

describe("protección CSRF", () => {
  it("rechaza escrituras que no son JSON", async () => {
    const r = await browser().call("POST", "/auth/entrar", "username=carlos", { "content-type": "application/x-www-form-urlencoded" });
    expect(r.status).toBe(415);
  });
  it("rechaza escrituras desde otro origen", async () => {
    const r = await browser().call("POST", "/auth/entrar", { username: "carlos", password: "x" }, { origin: "https://malicioso.test" });
    expect(r.status).toBe(403);
  });
});

/* ---------- administración de usuarios ---------- */

describe("usuarios", () => {
  it("el administrador crea un usuario que debe cambiar su contraseña al entrar", async () => {
    const admin = await setupAdmin();
    const c = await admin.call("POST", "/usuarios", { username: "ana.lopez", displayName: "Ana López", role: "admin", password: "Temporal2026" });
    expect(c.status).toBe(201);

    const ana = browser();
    const login = await ana.call("POST", "/auth/entrar", { username: "ana.lopez", password: "Temporal2026" });
    expect(login.data).toMatchObject({ ok: true, mustChangePassword: true });

    // Mientras no cambie la contraseña, solo puede ver su perfil y cambiarla.
    expect((await ana.call("GET", "/campaigns")).status).toBe(403);
    expect((await ana.call("GET", "/me")).data).toMatchObject({ mustChangePassword: true });

    const bad = await ana.call("POST", "/auth/cambiar-clave", { currentPassword: "Temporal2026", newPassword: "corta" });
    expect(bad.status).toBe(400);
    const ok = await ana.call("POST", "/auth/cambiar-clave", { currentPassword: "Temporal2026", newPassword: "MiClaveNueva2026" });
    expect(ok.status).toBe(200);
    expect((await ana.call("GET", "/campaigns")).status).toBe(200);
  });

  it("no permite usuarios repetidos", async () => {
    const admin = await setupAdmin();
    const r = await admin.call("POST", "/usuarios", { username: "CARLOS", displayName: "Otro", role: "admin", password: "Temporal2026" });
    expect(r.status).toBe(409);
  });

  it("restablecer la contraseña cierra las sesiones de esa persona", async () => {
    const admin = await setupAdmin();
    const { data } = await admin.call("POST", "/usuarios", { username: "luis", displayName: "Luis", role: "lector", password: "Temporal2026" });
    const id = (data.user as { id: number }).id;
    const luis = browser();
    await luis.call("POST", "/auth/entrar", { username: "luis", password: "Temporal2026" });
    expect((await admin.call("POST", `/usuarios/${id}/clave`, { password: "OtraTemporal2026" })).status).toBe(200);
    expect((await luis.call("GET", "/me")).status).toBe(401);
  });

  it("desactivar a alguien lo saca y ya no puede entrar", async () => {
    const admin = await setupAdmin();
    const { data } = await admin.call("POST", "/usuarios", { username: "luis", displayName: "Luis", role: "lector", password: "Temporal2026" });
    const id = (data.user as { id: number }).id;
    const luis = browser();
    await luis.call("POST", "/auth/entrar", { username: "luis", password: "Temporal2026" });
    expect((await admin.call("PATCH", `/usuarios/${id}`, { active: false })).status).toBe(200);
    expect((await luis.call("GET", "/me")).status).toBe(401);
    expect((await browser().call("POST", "/auth/entrar", { username: "luis", password: "Temporal2026" })).status).toBe(401);
  });

  it("editar el perfil: nombre y usuario (sin repetir usuario); entra con el nuevo", async () => {
    const admin = await setupAdmin();
    const { data } = await admin.call("POST", "/usuarios", { username: "luis", displayName: "Luis", role: "lector", password: "Temporal2026" });
    const id = (data.user as { id: number }).id;
    await admin.call("POST", "/usuarios", { username: "ana", displayName: "Ana", role: "lector", password: "Temporal2026" });
    expect((await admin.call("PATCH", `/usuarios/${id}`, { username: "ana" })).status).toBe(409);
    expect((await admin.call("PATCH", `/usuarios/${id}`, { username: "x" })).status).toBe(400);
    const r = await admin.call("PATCH", `/usuarios/${id}`, { displayName: "  Luis   Hernández ", username: "Luis.Hernandez" });
    expect(r.status).toBe(200);
    expect(r.data.user).toMatchObject({ displayName: "Luis Hernández", username: "luis.hernandez", role: "lector" });
    expect((await browser().call("POST", "/auth/entrar", { username: "luis.hernandez", password: "Temporal2026" })).status).toBe(200);
    expect((await browser().call("POST", "/auth/entrar", { username: "luis", password: "Temporal2026" })).status).toBe(401);
  });

  it("no deja la app sin administrador", async () => {
    const admin = await setupAdmin();
    const me = (await admin.call("GET", "/me")).data as { id: number };
    const r = await admin.call("PATCH", `/usuarios/${me.id}`, { role: "lector" });
    expect(r.status).toBe(400);
  });

  it("un lector no puede administrar usuarios", async () => {
    const admin = await setupAdmin();
    await admin.call("POST", "/usuarios", { username: "luis", displayName: "Luis", role: "lector", password: "Temporal2026" });
    const luis = browser();
    await luis.call("POST", "/auth/entrar", { username: "luis", password: "Temporal2026" });
    await luis.call("POST", "/auth/cambiar-clave", { currentPassword: "Temporal2026", newPassword: "Cambiada2026xyz" });
    expect((await luis.call("GET", "/me")).data).toMatchObject({ mustChangePassword: false });
    expect((await luis.call("GET", "/usuarios")).status).toBe(403);
    expect((await luis.call("GET", "/campaigns")).status).toBe(200);
  });

  it("el administrador desbloquea a un usuario bloqueado", async () => {
    const admin = await setupAdmin();
    const { data } = await admin.call("POST", "/usuarios", { username: "luis", displayName: "Luis", role: "lector", password: "Temporal2026" });
    const id = (data.user as { id: number }).id;
    for (let i = 0; i < 5; i++) await browser().call("POST", "/auth/entrar", { username: "luis", password: "Mala123456" });
    expect((await browser().call("POST", "/auth/entrar", { username: "luis", password: "Temporal2026" })).status).toBe(429);
    await admin.call("PATCH", `/usuarios/${id}`, { unlock: true });
    expect((await browser().call("POST", "/auth/entrar", { username: "luis", password: "Temporal2026" })).status).toBe(200);
  });
});

/* ---------- otras rutas ---------- */

describe("API", () => {
  it("/api/health responde sin sesión y sin detalles internos", async () => {
    const r = await browser().call("GET", "/health");
    expect(r.status).toBe(200);
    expect(Object.keys(r.data).sort()).toEqual(["d1", "ok", "r2", "version"]);
  });
  it("rutas desconocidas responden 404 y métodos equivocados 405", async () => {
    expect((await browser().call("GET", "/no-existe")).status).toBe(404);
    expect((await browser().call("DELETE", "/health")).status).toBe(405);
  });
  it("/api/campaigns devuelve las 6 campañas", async () => {
    const admin = await setupAdmin();
    const r = await admin.call("GET", "/campaigns");
    expect((r.data.campaigns as { code: string }[]).map((c) => c.code)).toEqual(["tdc", "extrafin", "cdc", "upin", "seguros", "domi"]);
  });
});
