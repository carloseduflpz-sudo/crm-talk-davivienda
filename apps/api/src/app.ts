/* API del CRM. Todas las rutas viven bajo /api y responden JSON en español. */
import { CAMPAIGNS, can, permissionsOf, type Permission } from "@crm/core";
import { Hono, type MiddlewareHandler } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { identify } from "./auth";
import type { AppContext } from "./env";

export const VERSION = "2.0.0-fase0";

const requireUser: MiddlewareHandler<AppContext> = async (c, next) => {
  const r = await identify(c.req.raw, c.env);
  if (!r.ok) return c.json({ ok: false, error: r.error }, r.status);
  c.set("user", r.user);
  await next();
};

export const requirePermission =
  (permission: Permission): MiddlewareHandler<AppContext> =>
  async (c, next) => {
    const user = c.get("user");
    if (!can(user.role, permission)) {
      return c.json({ ok: false, error: `Tu usuario (${user.email}) no tiene permiso para esta acción.` }, 403);
    }
    await next();
  };

export function createApp() {
  const app = new Hono<AppContext>().basePath("/api");

  app.use("*", secureHeaders());
  app.use("*", async (c, next) => {
    await next();
    c.header("Cache-Control", "no-store");
  });

  // Pública: solo dice si cada pieza responde, sin detalles internos.
  app.get("/health", async (c) => {
    const out = { ok: true, version: VERSION, d1: false, r2: false, access: Boolean(c.env.ACCESS_TEAM_DOMAIN && c.env.ACCESS_AUD) };
    try {
      await c.env.DB.prepare("SELECT 1").first();
      out.d1 = true;
    } catch (e) {
      console.error("health d1", e);
    }
    try {
      await c.env.FILES.head("_health");
      out.r2 = true;
    } catch (e) {
      console.error("health r2", e);
    }
    out.ok = out.d1 && out.r2;
    return c.json(out, out.ok ? 200 : 503);
  });

  // De aquí en adelante, todo requiere sesión de Access.
  app.use("*", requireUser);

  app.get("/me", (c) => {
    const user = c.get("user");
    return c.json({ ok: true, email: user.email, role: user.role, permissions: permissionsOf(user.role) });
  });

  app.get("/campaigns", (c) =>
    c.json({
      ok: true,
      campaigns: CAMPAIGNS.map((cp) => ({
        code: cp.code,
        name: cp.name,
        shortName: cp.shortName,
        datasets: cp.datasets,
      })),
    }),
  );

  app.notFound((c) => c.json({ ok: false, error: "Ruta no encontrada." }, 404));
  app.onError((err, c) => {
    console.error("API error", err);
    return c.json({ ok: false, error: "Error interno. Ya quedó registrado; intenta de nuevo." }, 500);
  });

  return app;
}
