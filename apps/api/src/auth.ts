/* Sesiones con cookie segura.
   - El navegador guarda un token aleatorio en una cookie HttpOnly (JavaScript no la puede leer).
   - La base guarda solo la huella SHA-256 del token: si alguien leyera la base, no podría entrar.
   - Las sesiones vencen a las 12 horas. */
import { ROLES, type Role } from "@crm/core";
import type { Env, User } from "./env";

export const SESSION_COOKIE = "crm_sesion";
export const SESSION_HOURS = 12;
const SESSION_MS = SESSION_HOURS * 60 * 60 * 1000;

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

function cookie(value: string, maxAgeSeconds: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function isSecure(req: Request): boolean {
  return new URL(req.url).protocol === "https:";
}

/** Crea una sesión y devuelve la cabecera Set-Cookie. */
export async function createSession(env: Env, req: Request, userId: number): Promise<string> {
  const token = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const id = await sha256Hex(token);
  const now = Date.now();
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 200) || null;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    env.DB.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)").bind(id, userId, now, now + SESSION_MS, ua),
  ]);
  return cookie(token, SESSION_MS / 1000, isSecure(req));
}

export function clearSessionCookie(req: Request): string {
  return cookie("", 0, isSecure(req));
}

interface SessionRow {
  session_id: string;
  id: number;
  username: string;
  display_name: string;
  role: string;
  must_change_password: number;
}

/** Usuario de la sesión, o null si no hay sesión válida. */
export async function userFromRequest(env: Env, req: Request): Promise<User | null> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token || token.length > 100) return null;
  const id = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, u.id, u.username, u.display_name, u.role, u.must_change_password
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ? AND u.active = 1`,
  )
    .bind(id, Date.now())
    .first<SessionRow>();
  if (!row) return null;
  const role: Role = (ROLES as readonly string[]).includes(row.role) ? (row.role as Role) : "lector";
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role,
    mustChangePassword: Boolean(row.must_change_password),
    sessionId: row.session_id,
  };
}

export async function deleteSession(env: Env, sessionId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

/** Cierra todas las sesiones de un usuario, salvo la indicada. */
export async function deleteUserSessions(env: Env, userId: number, exceptSessionId?: string): Promise<void> {
  if (exceptSessionId) {
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").bind(userId, exceptSessionId).run();
  } else {
    await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  }
}

/** Nombre de usuario normalizado, o null si no es válido. */
export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const u = raw.trim().toLowerCase();
  return /^[a-z0-9._-]{3,32}$/.test(u) ? u : null;
}
