/* Ficha del cliente para darle seguimiento: sus datos de contacto (de la sábana, la base o el CRM),
   sus ventas con todo lo que trae la sábana, en qué bases viene, sus llamadas y lo capturado en el CRM.
   Solo archivos vigentes; agentes con el nombre homologado. */
import { CAMPAIGNS, isCampaignCode, normHeader } from "@crm/core";
import { loadAgentNaming } from "./agentes";
import type { Env } from "./env";
import { HttpError, json, type Router } from "./http";

type Extra = Record<string, unknown>;

export function parseExtra(v: unknown): Extra {
  if (typeof v !== "string" || !v) return {};
  try {
    const o = JSON.parse(v) as unknown;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Extra) : {};
  } catch {
    return {};
  }
}

/** Columnas donde suele venir cada dato, según el archivo (en orden de preferencia). */
const CONTACT_KEYS = {
  nombre: ["NOMBRE", "Nombre", "NOMBRE DEL CLIENTE", "NOMBRE DE CLIENTE", "Nombre del cliente", "Nombre Completo", "NombreSociedad", "Nombre legal según IBS"],
  telefono: [
    "CELULAR CLIENTE", "TEL. VENTA REALIZADA", "Telefono", "Teléfono", "TelNotif", "TEL Notificaciones", "TelNotificaciones", "Tel. 1", "Tel.1", "Telefono1",
    "Telefono2", "Telefono3", "Celular",
  ],
  dui: ["DUI", "DUI OK", "Dui", "NumeroDUI"],
  correo: ["CORREO ELECTRONICO", "Correo", "Correo Electrónico", "Correo Electronico"],
  municipio: ["Municipio"],
  departamento: ["Departamento"],
} as const;

const keyIndex = (e: Extra) => new Map(Object.keys(e).map((k) => [normHeader(k), k]));
const clean = (v: unknown) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s && s !== "-" && s !== "0" ? s : null;
};

export interface Contact {
  nombre: string | null;
  telefono: string | null;
  telefonos: string[];
  dui: string | null;
  correo: string | null;
  municipio: string | null;
  departamento: string | null;
}

/** Datos de contacto: el primero que aparezca, buscando en las fuentes en el orden dado. */
export function contactFrom(...extras: Extra[]): Contact {
  const pick = (keys: readonly string[]) => {
    for (const e of extras) {
      const idx = keyIndex(e);
      for (const k of keys) {
        const real = idx.get(normHeader(k));
        const v = real ? clean(e[real]) : null;
        if (v) return v;
      }
    }
    return null;
  };
  const phones: string[] = [];
  for (const e of extras) {
    const idx = keyIndex(e);
    for (const k of CONTACT_KEYS.telefono) {
      const real = idx.get(normHeader(k));
      const v = real ? clean(e[real]) : null;
      if (v && !phones.includes(v)) phones.push(v);
    }
  }
  return {
    nombre: pick(CONTACT_KEYS.nombre),
    telefono: phones[0] ?? null,
    telefonos: phones,
    dui: pick(CONTACT_KEYS.dui),
    correo: pick(CONTACT_KEYS.correo),
    municipio: pick(CONTACT_KEYS.municipio),
    departamento: pick(CONTACT_KEYS.departamento),
  };
}

const LIMIT = 200;

export function registerClientes(r: Router): void {
  r.on("GET", "/clientes/:niu", "datos:ver", async ({ env, params, url }) => {
    // Igual que al cargar: sin espacios, puntos ni guiones, y sin ceros a la izquierda.
    let given = params.niu ?? "";
    try {
      given = decodeURIComponent(given);
    } catch {
      /* ya venía sin codificar */
    }
    const raw = given.replace(/[\s.-]/g, "");
    if (!/^\d{1,30}$/.test(raw)) throw new HttpError(400, "Escribe un NIU válido (solo números).");
    const niu = raw.replace(/^0+(?=\d)/, "");
    const only = url.searchParams.get("campana");
    if (only && !isCampaignCode(only)) throw new HttpError(404, "Campaña desconocida.");
    const campaigns = only ? [only] : CAMPAIGNS.map((c) => c.code);
    const out = [];
    for (const campaign of campaigns) {
      const found = await clientInCampaign(env, campaign, niu);
      if (found) out.push(found);
    }
    const contacto = contactFrom(...out.flatMap((c) => [...c.ventas.map((v) => v.extra), ...c.crm.map((v) => v.extra), ...c.bases.map((b) => b.extra)]));
    return json({ ok: true, niu, contacto, campanas: out });
  });
}

async function clientInCampaign(env: Env, campaign: string, niu: string) {
  const db = env.DB;
  const current = "SELECT id FROM uploads WHERE campaign = ?1 AND is_current = 1";
  const naming = await loadAgentNaming(env, campaign);
  const [ventas, bases, llamadas, crm] = await db.batch([
    db
      .prepare(
        `SELECT s.month, s.sale_date, ${naming.sql("s.executive")} AS agent, s.status_raw, s.status_class, s.reason, s.amount, s.process, s.days_in_process, s.extra
           FROM bank_sales s WHERE s.niu = ?2 AND s.upload_id IN (${current}) ORDER BY s.month DESC, s.sale_date DESC LIMIT ${LIMIT}`,
      )
      .bind(campaign, niu),
    db
      .prepare(
        `SELECT b.month, b.dataset, b.profile, b.offer, b.extra, u.is_addition, u.label
           FROM base_records b JOIN uploads u ON u.id = b.upload_id
          WHERE b.niu = ?2 AND b.upload_id IN (${current}) ORDER BY b.month DESC LIMIT ${LIMIT}`,
      )
      .bind(campaign, niu),
    db
      .prepare(
        `SELECT c.month, c.called_at, ${naming.sql("c.agent")} AS agent, c.category, c.tipologia, c.call_class
           FROM calls c WHERE c.niu = ?2 AND c.upload_id IN (${current}) ORDER BY c.called_at DESC LIMIT ${LIMIT}`,
      )
      .bind(campaign, niu),
    db
      .prepare(
        `SELECT c.month, c.entered_at, ${naming.sql("c.agent")} AS agent, c.product, c.extra
           FROM crm_sales c WHERE c.niu = ?2 AND c.upload_id IN (${current}) ORDER BY c.entered_at DESC LIMIT ${LIMIT}`,
      )
      .bind(campaign, niu),
  ]);
  type V = { month: string; sale_date: string | null; agent: string; status_raw: string | null; status_class: string; reason: string | null; amount: number | null; process: string | null; days_in_process: number | null; extra: string | null };
  type B = { month: string; dataset: string; profile: string | null; offer: string | null; extra: string | null; is_addition: number; label: string | null };
  type L = { month: string; called_at: string | null; agent: string; category: string | null; tipologia: string | null; call_class: string };
  type C = { month: string; entered_at: string | null; agent: string; product: string | null; extra: string | null };
  const v = ventas!.results as V[];
  const b = bases!.results as B[];
  const l = llamadas!.results as L[];
  const c = crm!.results as C[];
  if (!v.length && !b.length && !l.length && !c.length) return null;
  // Con qué sábana está al día la ficha (la vigente más reciente de la campaña).
  const sabana = await db
    .prepare("SELECT month, created_at FROM uploads WHERE campaign = ? AND kind = 'sabana' AND is_current = 1 ORDER BY month DESC LIMIT 1")
    .bind(campaign)
    .first<{ month: string; created_at: number }>();
  return {
    campaign,
    sabana: sabana ? { month: sabana.month, cargada: sabana.created_at } : null,
    ventas: v.map((x) => ({
      month: x.month,
      fecha: x.sale_date,
      agente: x.agent,
      estatus: x.status_raw,
      clase: x.status_class,
      motivo: x.reason,
      monto: x.amount,
      proceso: x.process,
      dias: x.days_in_process,
      extra: parseExtra(x.extra),
    })),
    bases: b.map((x) => ({ month: x.month, dataset: x.dataset, perfil: x.profile, oferta: x.offer, adicional: Boolean(x.is_addition), nombreBase: x.label, extra: parseExtra(x.extra) })),
    llamadas: l.map((x) => ({ month: x.month, fecha: x.called_at, agente: x.agent, categoria: x.category, tipologia: x.tipologia, clase: x.call_class })),
    crm: c.map((x) => ({ month: x.month, fecha: x.entered_at, agente: x.agent, producto: x.product, extra: parseExtra(x.extra) })),
  };
}
