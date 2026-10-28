/* API del CRM. Todas las rutas viven bajo /api y responden JSON en español. */
import { CAMPAIGNS, ROLES, permissionsOf, type Role } from "@crm/core";
import { audit } from "./audit";
import { registerAnalisis } from "./analisis";
import { registerCargas } from "./cargas";
import { registerClientes } from "./clientes";
import { registerOficial } from "./oficial";
import { registerPresentacion } from "./presentacion";
import { registerDetalle } from "./detalle";
import {
  LOCK_MINUTES,
  MAX_FAILED_ATTEMPTS,
  clearSessionCookie,
  createSession,
  deleteSession,
  deleteUserSessions,
  normalizeUsername,
} from "./auth";
import { HttpError, Router, json, readJson, requireString } from "./http";
import { hashPassword, passwordProblem, timingSafeEqualText, verifyPassword } from "./password";

export const VERSION = "2.1.0-interactiva";

const INVALID_LOGIN = "Usuario o contraseña incorrectos.";

/* Hash de relleno: si el usuario no existe se verifica igual, para que la respuesta
   tarde lo mismo y no delate qué usuarios existen. */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("relleno-sin-uso-0000"));

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: string;
  password_hash: string;
  must_change_password: number;
  active: number;
  failed_attempts: number;
  locked_until: number | null;
  last_login_at: number | null;
  created_at: number;
}

const publicUser = (u: UserRow) => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  role: u.role,
  active: Boolean(u.active),
  mustChangePassword: Boolean(u.must_change_password),
  lockedUntil: u.locked_until && u.locked_until > Date.now() ? u.locked_until : null,
  lastLoginAt: u.last_login_at,
  createdAt: u.created_at,
});

function parseRole(raw: unknown): Role {
  if (typeof raw !== "string" || !(ROLES as readonly string[]).includes(raw)) throw new HttpError(400, "El rol no es válido.");
  return raw as Role;
}

function parseDisplayName(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim().length < 2) throw new HttpError(400, "Escribe el nombre de la persona.");
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length > 80) throw new HttpError(400, "El nombre es demasiado largo.");
  return name;
}

function parseUsername(raw: unknown): string {
  const u = normalizeUsername(raw);
  if (!u) throw new HttpError(400, "El usuario debe tener de 3 a 32 caracteres: letras, números, punto, guion o guion bajo.");
  return u;
}

function checkNewPassword(password: unknown, username: string): string {
  if (typeof password !== "string") throw new HttpError(400, "Falta la contraseña.");
  const problem = passwordProblem(password, username);
  if (problem) throw new HttpError(400, problem);
  return password;
}

async function countUsers(env: { DB: D1Database }): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return r?.n ?? 0;
}

async function getUser(env: { DB: D1Database }, id: number): Promise<UserRow> {
  const u = await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
  if (!u) throw new HttpError(404, "Ese usuario no existe.");
  return u;
}

function parseId(raw: string | undefined): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, "Ese usuario no existe.");
  return id;
}

export function createApp(): Router {
  const r = new Router();

  /* ---------- públicas ---------- */

  r.on("GET", "/health", "publica", async ({ env }) => {
    const out = { ok: true, version: VERSION, d1: false, r2: false };
    try {
      await env.DB.prepare("SELECT 1").first();
      out.d1 = true;
    } catch (e) {
      console.error("health d1", e);
    }
    try {
      await env.FILES.head("_health");
      out.r2 = true;
    } catch (e) {
      console.error("health r2", e);
    }
    out.ok = out.d1 && out.r2;
    return json(out, out.ok ? 200 : 503);
  });

  /** Si todavía no hay ningún usuario, la app muestra la configuración inicial. */
  r.on("GET", "/auth/estado", "publica", async ({ env }) => json({ ok: true, needsSetup: (await countUsers(env)) === 0 }));

  /** Crea el primer administrador. Solo funciona una vez y exige SETUP_TOKEN. */
  r.on("POST", "/auth/configurar", "publica", async ({ env, req }) => {
    const body = await readJson(req);
    if ((await countUsers(env)) > 0) throw new HttpError(409, "La app ya está configurada. Entra con tu usuario.");
    if (!env.SETUP_TOKEN || env.SETUP_TOKEN.length < 12) {
      throw new HttpError(503, "Falta definir SETUP_TOKEN (mínimo 12 caracteres) en Cloudflare: Settings → Variables and Secrets.");
    }
    const token = requireString(body, "token", "la clave de configuración");
    if (!timingSafeEqualText(token, env.SETUP_TOKEN)) throw new HttpError(403, "La clave de configuración no es correcta.");

    const username = parseUsername(body.username);
    const displayName = parseDisplayName(body.displayName);
    const password = checkNewPassword(body.password, username);
    const hash = await hashPassword(password);

    // Inserta solo si sigue sin haber usuarios (evita que dos personas configuren a la vez).
    const res = await env.DB.prepare(
      `INSERT INTO users (username, display_name, role, password_hash, must_change_password)
       SELECT ?, ?, 'admin', ?, 0 WHERE NOT EXISTS (SELECT 1 FROM users)`,
    )
      .bind(username, displayName, hash)
      .run();
    if (!res.meta.changes) throw new HttpError(409, "La app ya está configurada. Entra con tu usuario.");

    const user = await env.DB.prepare("SELECT id FROM users WHERE username = ?").bind(username).first<{ id: number }>();
    await audit(env, username, "configuracion_inicial", `usuario:${username}`);
    const setCookie = await createSession(env, req, user!.id);
    return json({ ok: true }, 201, { "set-cookie": setCookie });
  });

  r.on("POST", "/auth/entrar", "publica", async ({ env, req }) => {
    const body = await readJson(req);
    const username = normalizeUsername(body.username);
    const password = typeof body.password === "string" ? body.password.slice(0, 256) : "";
    const now = Date.now();

    const u = username ? await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<UserRow>() : null;
    if (!u) {
      await verifyPassword(password, await getDummyHash());
      throw new HttpError(401, INVALID_LOGIN);
    }
    if (u.locked_until && u.locked_until > now) {
      const min = Math.ceil((u.locked_until - now) / 60_000);
      throw new HttpError(429, `Usuario bloqueado por intentos fallidos. Intenta de nuevo en ${min} min o pide a un administrador que lo desbloquee.`);
    }

    const ok = await verifyPassword(password, u.password_hash);
    if (!ok || !u.active) {
      if (u.active) {
        const failed = u.failed_attempts + 1;
        const lock = failed >= MAX_FAILED_ATTEMPTS;
        await env.DB.prepare("UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?")
          .bind(lock ? 0 : failed, lock ? now + LOCK_MINUTES * 60_000 : u.locked_until, u.id)
          .run();
        await audit(env, u.username, lock ? "login_bloqueado" : "login_fallido", `usuario:${u.username}`);
      }
      throw new HttpError(401, INVALID_LOGIN);
    }

    await env.DB.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = ? WHERE id = ?").bind(now, u.id).run();
    await audit(env, u.username, "login", `usuario:${u.username}`);
    const setCookie = await createSession(env, req, u.id);
    return json({ ok: true, mustChangePassword: Boolean(u.must_change_password) }, 200, { "set-cookie": setCookie });
  });

  /* ---------- con sesión ---------- */

  r.on(
    "POST",
    "/auth/salir",
    "sesion",
    async ({ env, req, user }) => {
      await deleteSession(env, user.sessionId);
      return json({ ok: true }, 200, { "set-cookie": clearSessionCookie(req) });
    },
    { duringPasswordChange: true },
  );

  r.on(
    "GET",
    "/me",
    "sesion",
    ({ user }) =>
      json({
        ok: true,
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        permissions: permissionsOf(user.role),
        mustChangePassword: user.mustChangePassword,
      }),
    { duringPasswordChange: true },
  );

  r.on(
    "POST",
    "/auth/cambiar-clave",
    "sesion",
    async ({ env, req, user }) => {
      const body = await readJson(req);
      const current = requireString(body, "currentPassword", "tu contraseña actual", 256);
      const u = await getUser(env, user.id);
      if (!(await verifyPassword(current, u.password_hash))) throw new HttpError(400, "Tu contraseña actual no es correcta.");
      const next = checkNewPassword(body.newPassword, u.username);
      if (next === current) throw new HttpError(400, "La contraseña nueva debe ser distinta de la actual.");
      await env.DB.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
        .bind(await hashPassword(next), Date.now(), u.id)
        .run();
      await deleteUserSessions(env, u.id, user.sessionId); // cierra la sesión en otros dispositivos
      await audit(env, u.username, "cambio_clave", `usuario:${u.username}`);
      return json({ ok: true });
    },
    { duringPasswordChange: true },
  );

  r.on("GET", "/campaigns", "sesion", () =>
    json({
      ok: true,
      campaigns: CAMPAIGNS.map((c) => ({ code: c.code, name: c.name, shortName: c.shortName, datasets: c.datasets })),
    }),
  );

  /* ---------- administración de usuarios ---------- */

  r.on("GET", "/usuarios", "usuarios:administrar", async ({ env }) => {
    const { results } = await env.DB.prepare("SELECT * FROM users ORDER BY active DESC, display_name").all<UserRow>();
    return json({ ok: true, users: results.map(publicUser) });
  });

  r.on("POST", "/usuarios", "usuarios:administrar", async ({ env, req, user }) => {
    const body = await readJson(req);
    const username = parseUsername(body.username);
    const displayName = parseDisplayName(body.displayName);
    const role = parseRole(body.role ?? "admin");
    const password = checkNewPassword(body.password, username);
    const exists = await env.DB.prepare("SELECT 1 AS x FROM users WHERE username = ?").bind(username).first();
    if (exists) throw new HttpError(409, `Ya existe el usuario "${username}".`);
    await env.DB.prepare("INSERT INTO users (username, display_name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, 1)")
      .bind(username, displayName, role, await hashPassword(password))
      .run();
    const created = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<UserRow>();
    await audit(env, user.username, "usuario_creado", `usuario:${username}`, { role });
    return json({ ok: true, user: publicUser(created!) }, 201);
  });

  r.on("PATCH", "/usuarios/:id", "usuarios:administrar", async ({ env, req, user, params }) => {
    const target = await getUser(env, parseId(params.id));
    const body = await readJson(req);
    const displayName = body.displayName === undefined ? target.display_name : parseDisplayName(body.displayName);
    const username = body.username === undefined ? target.username : parseUsername(body.username);
    if (username !== target.username) {
      const taken = await env.DB.prepare("SELECT 1 AS x FROM users WHERE username = ? AND id <> ?").bind(username, target.id).first();
      if (taken) throw new HttpError(409, `Ya existe el usuario "${username}".`);
    }
    const role = body.role === undefined ? (target.role as Role) : parseRole(body.role);
    const active = body.active === undefined ? Boolean(target.active) : body.active === true;
    const unlock = body.unlock === true;

    // Nunca puede quedar la app sin un administrador activo.
    const losesAdmin = target.role === "admin" && target.active && (role !== "admin" || !active);
    if (losesAdmin) {
      const others = await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?")
        .bind(target.id)
        .first<{ n: number }>();
      if (!others?.n) throw new HttpError(400, "Debe quedar al menos un administrador activo.");
    }
    if (target.id === user.id && !active) throw new HttpError(400, "No puedes desactivar tu propio usuario.");

    await env.DB.prepare(
      `UPDATE users SET display_name = ?, username = ?, role = ?, active = ?, updated_at = ?,
              failed_attempts = CASE WHEN ? THEN 0 ELSE failed_attempts END,
              locked_until = CASE WHEN ? THEN NULL ELSE locked_until END
        WHERE id = ?`,
    )
      .bind(displayName, username, role, active ? 1 : 0, Date.now(), unlock ? 1 : 0, unlock ? 1 : 0, target.id)
      .run();
    if (!active) await deleteUserSessions(env, target.id);
    await audit(env, user.username, "usuario_editado", `usuario:${target.username}`, {
      role,
      active,
      unlock,
      ...(displayName !== target.display_name ? { nombre: displayName } : {}),
      ...(username !== target.username ? { usuario: username } : {}),
    });
    return json({ ok: true, user: publicUser(await getUser(env, target.id)) });
  });

  /** Asigna una contraseña temporal: la persona debe cambiarla al entrar. */
  r.on("POST", "/usuarios/:id/clave", "usuarios:administrar", async ({ env, req, user, params }) => {
    const target = await getUser(env, parseId(params.id));
    if (target.id === user.id) throw new HttpError(400, "Para cambiar tu propia contraseña usa la opción Cambiar contraseña.");
    const body = await readJson(req);
    const password = checkNewPassword(body.password, target.username);
    await env.DB.prepare(
      "UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?",
    )
      .bind(await hashPassword(password), Date.now(), target.id)
      .run();
    await deleteUserSessions(env, target.id);
    await audit(env, user.username, "clave_restablecida", `usuario:${target.username}`);
    return json({ ok: true });
  });

  registerCargas(r);
  registerAnalisis(r);
  registerDetalle(r);
  registerClientes(r);
  registerPresentacion(r);
  registerOficial(r);

  return r;
}
