/* Metas y cumplimientos oficiales (el Excel de cumplimientos de campaña): se guardan en R2 como JSON y sus metas
   también quedan en Metas (tabla goals), para que el cumplimiento de cada mes las use. Ver core/oficial.ts. */
import { isCampaignCode, unirOficial, type MesOficial, type Oficial } from "@crm/core";
import { audit } from "./audit";
import type { Env } from "./env";
import { HttpError, json, readJson, type Router } from "./http";

const CLAVE = "metas/oficial.json";
const MES = /^20\d{2}-(0[1-9]|1[0-2])$/;

/** Lo guardado (o null si nunca se subió el archivo). Si R2 falla, se sigue sin esos datos. */
export async function leerOficial(env: Env): Promise<Oficial | null> {
  try {
    const obj = await env.FILES.get(CLAVE);
    return obj ? ((await obj.json()) as Oficial) : null;
  } catch {
    return null;
  }
}

const valor = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1_000_000_000) throw new HttpError(400, "Hay una meta o un resultado que no es un número válido.");
  return Math.round(v * 100) / 100;
};

export function registerOficial(r: Router): void {
  r.on("GET", "/metas/oficial", "datos:ver", async ({ env }) => {
    const o = await leerOficial(env);
    // Metas que ya tiene la app, para compararlas con las del archivo antes de guardar.
    const { results } = await env.DB.prepare("SELECT campaign, month, sales_goal FROM goals WHERE sales_goal IS NOT NULL").all<{ campaign: string; month: string; sales_goal: number }>();
    return json({ ok: true, oficial: o, metasApp: results.map((x) => ({ campaign: x.campaign, month: x.month, meta: Number(x.sales_goal) })) });
  });

  r.on("PUT", "/metas/oficial", "config:editar", async ({ env, req, user }) => {
    const b = await readJson(req, 2_000_000);
    const archivo = typeof b.archivo === "string" ? b.archivo.slice(0, 200) : "Cumplimientos";
    if (!Array.isArray(b.meses) || !b.meses.length || b.meses.length > 2000) throw new HttpError(400, "El archivo no trae meses para guardar.");
    const meses: MesOficial[] = b.meses.map((m: Record<string, unknown>) => {
      if (!m || typeof m.campaign !== "string" || !isCampaignCode(m.campaign) || typeof m.month !== "string" || !MES.test(m.month)) throw new HttpError(400, "Hay un mes o una campaña inválidos en el archivo.");
      return { campaign: m.campaign, month: m.month, meta: valor(m.meta), real: valor(m.real) };
    });
    const antes = await leerOficial(env);
    const todo: Oficial = { archivo, por: user.username, fecha: Date.now(), meses: unirOficial(antes?.meses ?? [], meses) };
    await env.FILES.put(CLAVE, JSON.stringify(todo), { httpMetadata: { contentType: "application/json" } });

    // La meta de cada mes también queda en Metas: solo la meta; el HC, los estatus que cuentan, los días y los
    // feriados que ya tenga ese mes se respetan.
    const conMeta = meses.filter((m) => m.meta !== null);
    const ahora = Date.now();
    for (let i = 0; i < conMeta.length; i += 50) {
      await env.DB.batch(
        conMeta.slice(i, i + 50).map((m) =>
          env.DB.prepare(
            `INSERT INTO goals (campaign, month, sales_goal, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (campaign, month) DO UPDATE SET sales_goal = excluded.sales_goal, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
          ).bind(m.campaign, m.month, m.meta, user.username, ahora),
        ),
      );
    }
    await audit(env, user.username, "metas_oficiales", archivo, { meses: meses.length, metas: conMeta.length });
    return json({ ok: true, meses: meses.length, metas: conMeta.length });
  });
}
