import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { resetCertsCache, verifyAccessJwt } from "./auth";
import type { Env } from "./env";

/* ---------- utilidades de prueba ---------- */

const TEAM = "equipo-prueba.cloudflareaccess.com";
const AUD = "aud-de-prueba";

function fakeEnv(over: Partial<Env> = {}, users: Record<string, { role: string; active: number }> = {}): Env {
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...a: unknown[]) {
          args = a;
          return stmt;
        },
        async first() {
          if (sql.includes("FROM users")) return users[String(args[0])] ?? null;
          return { 1: 1 };
        },
        async run() {
          return { success: true };
        },
      };
      return stmt;
    },
  };
  return {
    ASSETS: { fetch: async () => new Response("app") } as unknown as Fetcher,
    DB: db as unknown as D1Database,
    FILES: { head: async () => null } as unknown as R2Bucket,
    ACCESS_TEAM_DOMAIN: TEAM,
    ACCESS_AUD: AUD,
    ADMIN_EMAILS: "carlos@talk.test, ana@talk.test",
    APP_ENV: "production",
    ...over,
  };
}

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let keys: CryptoKeyPair;
let publicJwk: JsonWebKey & { kid: string };

async function signToken(payload: Record<string, unknown>, kid = "k1", privateKey = keys.privateKey): Promise<string> {
  const h = b64url(JSON.stringify({ alg: "RS256", kid, typ: "JWT" }));
  const p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

const nowS = () => Math.floor(Date.now() / 1000);
const goodPayload = (over: Record<string, unknown> = {}) => ({
  aud: [AUD],
  email: "Carlos@Talk.test",
  iss: `https://${TEAM}`,
  exp: nowS() + 600,
  nbf: nowS() - 10,
  ...over,
});

beforeAll(async () => {
  keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  publicJwk = { ...(await crypto.subtle.exportKey("jwk", keys.publicKey)), kid: "k1" };
});

function mockCerts() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    expect(String(input)).toBe(`https://${TEAM}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: [publicJwk] }), { headers: { "content-type": "application/json" } });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  resetCertsCache();
});

/* ---------- token de Access ---------- */

describe("verificación del token de Access", () => {
  it("acepta un token válido y devuelve el correo en minúsculas", async () => {
    mockCerts();
    expect(await verifyAccessJwt(await signToken(goodPayload()), fakeEnv())).toBe("carlos@talk.test");
  });

  it.each([
    ["audiencia equivocada", { aud: ["otra"] }],
    ["vencido", { exp: nowS() - 3600 }],
    ["todavía no válido", { nbf: nowS() + 3600 }],
    ["emisor equivocado", { iss: "https://otro.cloudflareaccess.com" }],
    ["sin vencimiento", { exp: undefined }],
  ])("rechaza un token %s", async (_name, over) => {
    mockCerts();
    expect(await verifyAccessJwt(await signToken(goodPayload(over)), fakeEnv())).toBeNull();
  });

  it("rechaza un token firmado con otra clave", async () => {
    mockCerts();
    const other = (await crypto.subtle.generateKey(
      { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
      true,
      ["sign", "verify"],
    )) as CryptoKeyPair;
    expect(await verifyAccessJwt(await signToken(goodPayload(), "k1", other.privateKey), fakeEnv())).toBeNull();
  });

  it("rechaza basura sin romperse", async () => {
    mockCerts();
    expect(await verifyAccessJwt("no.es.token", fakeEnv())).toBeNull();
    expect(await verifyAccessJwt("abc", fakeEnv())).toBeNull();
  });
});

/* ---------- rutas ---------- */

describe("API", () => {
  const app = createApp();

  it("/api/health responde sin sesión y sin detalles internos", async () => {
    const res = await app.request("/api/health", {}, fakeEnv());
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, d1: true, r2: true, access: true });
    expect(Object.keys(body).sort()).toEqual(["access", "d1", "ok", "r2", "version"]);
  });

  it("sin token responde 401", async () => {
    const res = await app.request("/api/me", {}, fakeEnv());
    expect(res.status).toBe(401);
  });

  it("sin Access configurado no entrega datos (503)", async () => {
    const res = await app.request("/api/me", {}, fakeEnv({ ACCESS_AUD: "" }));
    expect(res.status).toBe(503);
  });

  it("con token válido devuelve el usuario y su rol", async () => {
    mockCerts();
    const token = await signToken(goodPayload());
    const res = await app.request("/api/me", { headers: { "Cf-Access-Jwt-Assertion": token } }, fakeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, email: "carlos@talk.test", role: "admin" });
  });

  it("la tabla users manda sobre ADMIN_EMAILS", async () => {
    mockCerts();
    const token = await signToken(goodPayload());
    const env = fakeEnv({}, { "carlos@talk.test": { role: "lector", active: 1 } });
    const res = await app.request("/api/me", { headers: { cookie: `CF_Authorization=${token}` } }, env);
    expect(await res.json()).toMatchObject({ role: "lector" });
  });

  it("el atajo de desarrollo no funciona en producción", async () => {
    const res = await app.request("/api/me", {}, fakeEnv({ AUTH_MODE: "dev", DEV_USER_EMAIL: "carlos@talk.test" }));
    expect(res.status).toBe(401);
  });

  it("el atajo de desarrollo funciona en local", async () => {
    const res = await app.request("/api/me", {}, fakeEnv({ AUTH_MODE: "dev", APP_ENV: "development", DEV_USER_EMAIL: "carlos@talk.test" }));
    expect(await res.json()).toMatchObject({ email: "carlos@talk.test", role: "admin" });
  });

  it("/api/campaigns devuelve las 6 campañas", async () => {
    const env = fakeEnv({ AUTH_MODE: "dev", APP_ENV: "development", DEV_USER_EMAIL: "carlos@talk.test" });
    const res = await app.request("/api/campaigns", {}, env);
    const body = (await res.json()) as { campaigns: { code: string }[] };
    expect(body.campaigns.map((c) => c.code)).toEqual(["tdc", "extrafin", "cdc", "upin", "seguros", "domi"]);
  });

  it("rutas desconocidas responden 404 en JSON", async () => {
    const env = fakeEnv({ AUTH_MODE: "dev", APP_ENV: "development" });
    const res = await app.request("/api/no-existe", {}, env);
    expect(res.status).toBe(404);
  });
});
