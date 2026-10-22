/* Identidad con Cloudflare Access.
   Access deja pasar solo a los correos autorizados y firma un token (JWT) con su clave.
   Aquí se verifica esa firma en cada llamada: sin token válido no se entrega ningún dato. */
import { ROLES, type Role } from "@crm/core";
import type { Env, User } from "./env";

interface Jwk extends JsonWebKey {
  kid?: string;
}
interface JwtPayload {
  aud?: string | string[];
  email?: string;
  exp?: number;
  nbf?: number;
  iss?: string;
}

const CERTS_TTL_MS = 60 * 60 * 1000;
const CLOCK_SKEW_S = 60;
let certsCache: { team: string; at: number; keys: Jwk[] } | null = null;

export function teamHost(env: Pick<Env, "ACCESS_TEAM_DOMAIN">): string {
  return String(env.ACCESS_TEAM_DOMAIN || "")
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "");
}

function b64urlToBytes(s: string): Uint8Array {
  let b = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b.length % 4) b += "=";
  const bin = atob(b);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as T;
}

async function accessCerts(team: string, forceRefresh = false): Promise<Jwk[]> {
  const now = Date.now();
  if (!forceRefresh && certsCache && certsCache.team === team && now - certsCache.at < CERTS_TTL_MS) return certsCache.keys;
  const res = await fetch(`https://${team}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`Access respondió ${res.status} al pedir certificados`);
  const body = (await res.json()) as { keys?: Jwk[] };
  certsCache = { team, at: now, keys: body.keys ?? [] };
  return certsCache.keys;
}

/** Para pruebas: olvida los certificados guardados. */
export function resetCertsCache(): void {
  certsCache = null;
}

/** Devuelve el correo verificado del token, o null si el token no es válido. */
export async function verifyAccessJwt(token: string, env: Pick<Env, "ACCESS_TEAM_DOMAIN" | "ACCESS_AUD">): Promise<string | null> {
  const team = teamHost(env);
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts as [string, string, string];

  let header: { kid?: string; alg?: string };
  let payload: JwtPayload;
  try {
    header = decodeJson(h);
    payload = decodeJson(p);
  } catch {
    return null;
  }
  if (header.alg !== "RS256") return null;

  // Si Access rotó sus claves, se vuelve a pedir la lista una vez.
  let jwk = (await accessCerts(team)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await accessCerts(team, true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  const nowS = Date.now() / 1000;
  if (typeof payload.exp !== "number" || payload.exp < nowS - CLOCK_SKEW_S) return null;
  if (typeof payload.nbf === "number" && payload.nbf > nowS + CLOCK_SKEW_S) return null;
  if (payload.iss && payload.iss !== `https://${team}`) return null;
  return payload.email ? String(payload.email).toLowerCase() : null;
}

function getCookie(req: Request, name: string): string | null {
  const c = req.headers.get("cookie") ?? "";
  const m = c.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m?.[1] ?? null;
}

/** Rol: primero la tabla users; si no está ahí, ADMIN_EMAILS → admin; si no, lector. */
export async function roleFor(email: string, env: Env): Promise<Role> {
  try {
    const row = await env.DB.prepare("SELECT role, active FROM users WHERE email = ?").bind(email).first<{ role: string; active: number }>();
    if (row) {
      if (!row.active) return "lector";
      if ((ROLES as readonly string[]).includes(row.role)) return row.role as Role;
    }
  } catch {
    // La tabla aún no existe (primera vez, antes de migrar): se usa ADMIN_EMAILS.
  }
  const admins = String(env.ADMIN_EMAILS || "")
    .toLowerCase()
    .split(/[,;\s]+/)
    .filter(Boolean);
  return admins.includes(email) ? "admin" : "lector";
}

export type IdentifyResult = { ok: true; user: User } | { ok: false; status: 401 | 503; error: string };

export async function identify(request: Request, env: Env): Promise<IdentifyResult> {
  // El atajo de desarrollo solo funciona fuera de producción y de las vistas previas.
  if (env.AUTH_MODE === "dev" && env.APP_ENV === "development") {
    const email = (env.DEV_USER_EMAIL || "dev@local").toLowerCase();
    return { ok: true, user: { email, role: await roleFor(email, env) } };
  }
  if (!teamHost(env) || !env.ACCESS_AUD) {
    return {
      ok: false,
      status: 503,
      error: "Cloudflare Access no está configurado (faltan ACCESS_TEAM_DOMAIN y ACCESS_AUD). Por seguridad, la API no entrega datos hasta que lo esté.",
    };
  }
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || getCookie(request, "CF_Authorization");
  if (!token) return { ok: false, status: 401, error: "No autenticado. Entra por la dirección protegida con Cloudflare Access." };
  let email: string | null = null;
  try {
    email = await verifyAccessJwt(token, env);
  } catch (e) {
    console.error("Error verificando Access", e);
    email = null;
  }
  if (!email) return { ok: false, status: 401, error: "Sesión de Access inválida o vencida. Recarga la página para volver a entrar." };
  return { ok: true, user: { email, role: await roleFor(email, env) } };
}
