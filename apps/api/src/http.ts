/* Enrutador mínimo de la API: sin dependencias externas, fácil de leer y de probar. */
import { can, type Permission } from "@crm/core";
import { userFromRequest } from "./auth";
import type { Env, User } from "./env";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const SECURITY_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "same-origin",
};

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...SECURITY_HEADERS, ...headers } });
}

export interface Ctx {
  req: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  /** Solo en rutas que exigen sesión. */
  user: User;
  waitUntil: (p: Promise<unknown>) => void;
}

/**
 * Quién puede usar la ruta:
 *  - "publica": cualquiera, sin sesión.
 *  - "sesion": cualquier usuario con sesión válida.
 *  - un permiso: usuario con sesión y ese permiso.
 */
export type Access = "publica" | "sesion" | Permission;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  access: Access;
  /** Se permite aunque el usuario deba cambiar su contraseña. */
  duringPasswordChange: boolean;
  /** Cuerpo binario (archivo) en lugar de JSON. */
  raw: boolean;
  handler: (ctx: Ctx) => Promise<Response> | Response;
}

const MAX_BODY_BYTES = 64 * 1024;

/** Lee el cuerpo JSON de la petición (por defecto, máximo 64 KB). */
export async function readJson(req: Request, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new HttpError(413, "La solicitud es demasiado grande.");
  const text = await req.text();
  if (text.length > maxBytes) throw new HttpError(413, "La solicitud es demasiado grande.");
  try {
    const value: unknown = text ? JSON.parse(text) : {};
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // cae al error de abajo
  }
  throw new HttpError(400, "La solicitud no tiene un formato válido.");
}

export function requireString(body: Record<string, unknown>, key: string, label: string, max = 200): string {
  const v = body[key];
  if (typeof v !== "string" || v.trim() === "") throw new HttpError(400, `Falta ${label}.`);
  if (v.length > max) throw new HttpError(400, `${label[0]?.toUpperCase()}${label.slice(1)} es demasiado largo.`);
  return v;
}

export class Router {
  private routes: Route[] = [];

  on(method: string, path: string, access: Access, handler: Route["handler"], opts: { duringPasswordChange?: boolean; raw?: boolean } = {}): this {
    const keys: string[] = [];
    const pattern = new RegExp(
      "^" +
        path.replace(/:(\w+)/g, (_m, k: string) => {
          keys.push(k);
          return "([^/]+)";
        }) +
        "/?$",
    );
    this.routes.push({ method, pattern, keys, access, handler, duringPasswordChange: opts.duringPasswordChange ?? false, raw: opts.raw ?? false });
    return this;
  }

  async handle(req: Request, env: Env, waitUntil: Ctx["waitUntil"], prefix = "/api"): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.slice(prefix.length) || "/";
    try {
      const matches = this.routes.filter((r) => r.pattern.test(path));
      if (matches.length === 0) throw new HttpError(404, "Ruta no encontrada.");
      const route = matches.find((r) => r.method === req.method);
      if (!route) throw new HttpError(405, "Método no permitido.");

      // Protección contra peticiones desde otros sitios (CSRF): toda escritura debe ser JSON
      // (o, para archivos, llevar una cabecera propia que un formulario ajeno no puede poner)
      // y, si el navegador indica el origen, debe ser este mismo sitio.
      if (req.method !== "GET" && req.method !== "HEAD") {
        const ct = req.headers.get("content-type") ?? "";
        if (route.raw) {
          if (req.headers.get("x-crm-archivo") !== "1") throw new HttpError(400, "Falta la cabecera del archivo.");
        } else if (!ct.toLowerCase().startsWith("application/json")) {
          throw new HttpError(415, "Las escrituras deben enviarse como JSON.");
        }
        const origin = req.headers.get("origin");
        if (origin && origin !== url.origin) throw new HttpError(403, "Origen no permitido.");
      }

      const params: Record<string, string> = {};
      const m = route.pattern.exec(path);
      route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m?.[i + 1] ?? "")));

      const ctx = { req, env, url, params, waitUntil } as Ctx;
      if (route.access !== "publica") {
        const user = await userFromRequest(env, req);
        if (!user) throw new HttpError(401, "Tu sesión no es válida o ya venció. Vuelve a entrar.");
        if (user.mustChangePassword && !route.duringPasswordChange) {
          throw new HttpError(403, "Debes cambiar tu contraseña antes de continuar.", { mustChangePassword: true });
        }
        if (route.access !== "sesion" && !can(user.role, route.access)) {
          throw new HttpError(403, "Tu usuario no tiene permiso para esta acción.");
        }
        ctx.user = user;
      }
      return await route.handler(ctx);
    } catch (err) {
      if (err instanceof HttpError) return json({ ok: false, error: err.message, ...err.extra }, err.status);
      console.error("API error", err);
      const detail = err instanceof Error ? err.message : String(err);
      // Límites de Cloudflare D1 (filas escritas por día, tamaño, tiempo): se explica qué pasó en vez de un error genérico.
      if (/D1|SQLITE/i.test(detail) && /exceed|limit|quota|too (many|big|large)|reset because/i.test(detail)) {
        return json(
          {
            ok: false,
            code: "limite_cloudflare",
            error: "Cloudflare rechazó la operación por un límite de la base de datos (en el plan gratuito: 100 000 filas escritas por día). Revisa el plan de Workers en Cloudflare.",
            detail: detail.slice(0, 300),
          },
          503,
        );
      }
      return json({ ok: false, error: "Error interno. Ya quedó registrado; intenta de nuevo.", detail: detail.slice(0, 300) }, 500);
    }
  }
}
