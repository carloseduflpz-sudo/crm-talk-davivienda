/* Ficha del cliente para darle seguimiento: sus datos de contacto (de la sábana, la base o el CRM),
   sus ventas con todo lo que trae la sábana, en qué bases viene, sus llamadas y lo capturado en el CRM.
   Solo archivos vigentes; agentes con el nombre homologado. */
import { CAMPAIGNS, isCampaignCode, normHeader, telefonoSV } from "@crm/core";
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

/* ---------- búsqueda por nombre o teléfono ---------- */

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Palabras de un nombre buscado (sin acentos, solo letras). */
export const palabrasDe = (q: string) =>
  sinAcentos(q)
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .slice(0, 5);
/** Patrón LIKE flojo (vocales y la n valen cualquier letra: "nunez" encuentra "NUÑEZ" y "Núñez"); el filtro exacto va después. */
const patron = (w: string) => `%${w.replace(/[aeioun]/g, "_")}%`;
/** ¿El nombre trae todas las palabras buscadas? (sin acentos ni mayúsculas) */
export const nombreCoincide = (nombre: string | null, palabras: string[]) => {
  if (!nombre) return false;
  const n = ` ${sinAcentos(nombre).replace(/[^a-z]+/g, " ")} `;
  return palabras.every((w) => n.includes(` ${w}`));
};

export interface Coincidencia {
  niu: string;
  nombre: string | null;
  telefono: string | null;
  campanas: string[];
  /** Por qué salió: el NIU tal cual, su teléfono o su nombre. */
  por: "niu" | "telefono" | "nombre" | "dui";
  dui: string | null;
}

const MAX_RESULTADOS = 50;
const sinTelefonos = ({ telefonos: _t, duis: _d, ...c }: Coincidencia & { telefonos: string[]; duis: string[] }): Coincidencia => c;
/** DUI solo con sus dígitos y sin ceros adelante ("01234567-8", "012345678" y "1234567-8" son el mismo). */
export const duiLimpio = (v: unknown) => String(v ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");

/** Nombre, teléfono y campañas de cada NIU, con sus archivos vigentes. */
async function resumirNius(env: Env, nius: string[]): Promise<Map<string, Omit<Coincidencia, "por"> & { telefonos: string[]; duis: string[] }>> {
  const out = new Map<string, Omit<Coincidencia, "por"> & { telefonos: string[]; duis: string[] }>();
  if (!nius.length) return out;
  const db = env.DB;
  const lista = JSON.stringify(nius);
  const cur = "SELECT id FROM uploads WHERE is_current = 1";
  const res = await db.batch(
    (["bank_sales", "crm_sales", "base_records"] as const).map((t) =>
      db.prepare(`SELECT x.niu, x.campaign, x.extra FROM ${t} x WHERE x.niu IN (SELECT value FROM json_each(?)) AND x.upload_id IN (${cur}) LIMIT 2000`).bind(lista),
    ),
  );
  const extras = new Map<string, Extra[]>();
  const camps = new Map<string, Set<string>>();
  for (const r of res) {
    for (const row of r.results as { niu: string; campaign: string; extra: string | null }[]) {
      extras.set(row.niu, [...(extras.get(row.niu) ?? []), parseExtra(row.extra)]);
      camps.set(row.niu, (camps.get(row.niu) ?? new Set()).add(row.campaign));
    }
  }
  for (const n of nius) {
    const c = contactFrom(...(extras.get(n) ?? []));
    // Todos los DUI que traen sus archivos (en columnas como "DUI", "DUI OK", "NumeroDUI").
    const duis = [...new Set((extras.get(n) ?? []).flatMap((e) => Object.entries(e).filter(([k]) => /dui/i.test(k)).map(([, v]) => duiLimpio(v))).filter((d) => d.length >= 7))];
    out.set(n, { niu: n, nombre: c.nombre, telefono: c.telefono, dui: c.dui, telefonos: c.telefonos, duis, campanas: [...(camps.get(n) ?? [])] });
  }
  return out;
}

/** Busca clientes por nombre (todas las palabras) o por teléfono (y, si es un número, también como NIU). */
export async function buscarClientes(env: Env, q: string): Promise<{ tipo: "nombre" | "telefono"; resultados: Coincidencia[] }> {
  const db = env.DB;
  const cur = "SELECT id FROM uploads WHERE is_current = 1";
  if (/[a-záéíóúñü]/i.test(q)) {
    const palabras = palabrasDe(q);
    if (!palabras.length || palabras.join("").length < 3) throw new HttpError(400, "Escribe al menos un nombre o apellido (3 letras o más).");
    const cond = palabras.map(() => "x.extra LIKE ?").join(" AND ");
    const binds = palabras.map(patron);
    const res = await db.batch(
      (["base_records", "bank_sales", "crm_sales"] as const).map((t) =>
        db.prepare(`SELECT x.niu, x.extra FROM ${t} x WHERE x.upload_id IN (${cur}) AND x.niu <> '' AND ${cond} LIMIT 400`).bind(...binds),
      ),
    );
    // Solo los que de verdad se llaman así (el patrón de la base es flojo y también mira direcciones u otros campos).
    const nius: string[] = [];
    for (const r of res) {
      for (const row of r.results as { niu: string; extra: string | null }[]) {
        if (nius.includes(row.niu) || nius.length >= MAX_RESULTADOS) continue;
        if (nombreCoincide(contactFrom(parseExtra(row.extra)).nombre, palabras)) nius.push(row.niu);
      }
    }
    const info = await resumirNius(env, nius);
    return { tipo: "nombre", resultados: nius.map((n) => sinTelefonos({ ...info.get(n)!, por: "nombre" })) };
  }

  const digitos = q.replace(/\D/g, "");
  if (digitos.length < 7) throw new HttpError(400, "Escribe un teléfono de 8 dígitos, un DUI o un NIU.");
  const tel = telefonoSV(digitos);
  // exacto: el NIU tal cual, o el teléfono en la base o en la llamada. Lo que salió de buscar dentro de los archivos
  // (LIKE flojo) se confirma después contra los teléfonos o el DUI del cliente. Un cliente puede salir por varios motivos.
  const found: { niu: string; por: Coincidencia["por"]; exacto: boolean }[] = [];
  const add = (niu: string, por: Coincidencia["por"], exacto = true) => {
    if (niu && !found.some((f) => f.niu === niu && f.por === por) && found.length < MAX_RESULTADOS * 4) found.push({ niu, por, exacto });
  };
  // ¿Es un NIU que existe tal cual?
  const niu = digitos.replace(/^0+(?=\d)/, "");
  const [comoNiu] = await db.batch([
    db.prepare(
      `SELECT 1 AS x FROM bank_sales WHERE niu = ?1 AND upload_id IN (${cur})
       UNION ALL SELECT 1 FROM base_records WHERE niu = ?1 AND upload_id IN (${cur}) LIMIT 1`,
    ).bind(niu),
  ]);
  if (comoNiu!.results.length) add(niu, "niu");
  // DUI (9 dígitos, con o sin guion; también sin el cero de adelante): se busca dentro de los archivos y se confirma después.
  const dui = duiLimpio(digitos);
  if (dui.length >= 7 && dui.length <= 9) {
    const flojoDui = `%${dui.slice(0, -1)}%${dui.slice(-1)}%`;
    const res = await db.batch(
      (["base_records", "bank_sales", "crm_sales"] as const).map((t) => db.prepare(`SELECT DISTINCT niu FROM ${t} WHERE upload_id IN (${cur}) AND niu <> '' AND extra LIKE ? LIMIT 100`).bind(flojoDui)),
    );
    for (const r of res) for (const row of r.results as { niu: string }[]) add(row.niu, "dui", false);
  }
  if (tel) {
    // Teléfono: en las bases (sus columnas de teléfono), en las llamadas y en la sábana, el CRM o la base (escrito con guion o espacios).
    const flojo = `%${tel.slice(0, 4)}%${tel.slice(4)}%`;
    const res = await db.batch([
      db.prepare(`SELECT DISTINCT niu FROM base_phones WHERE phone = ? AND upload_id IN (${cur}) LIMIT 100`).bind(tel),
      db.prepare(`SELECT DISTINCT niu FROM calls WHERE upload_id IN (${cur} AND kind = 'tipif') AND phone = ? AND niu <> '' LIMIT 100`).bind(tel),
      db.prepare(`SELECT DISTINCT niu FROM bank_sales WHERE upload_id IN (${cur}) AND extra LIKE ? LIMIT 100`).bind(flojo),
      db.prepare(`SELECT DISTINCT niu FROM crm_sales WHERE upload_id IN (${cur}) AND extra LIKE ? LIMIT 100`).bind(flojo),
      // Bases a las que todavía no se les sacaron los teléfonos (se hace al cargar las tipificaciones del mes).
      db.prepare(`SELECT DISTINCT niu FROM base_records WHERE upload_id IN (${cur} AND kind = 'base' AND id NOT IN (SELECT upload_id FROM base_phones_listas)) AND extra LIKE ? LIMIT 100`).bind(flojo),
    ]);
    res.forEach((r, i) => {
      for (const row of r.results as { niu: string }[]) add(row.niu, "telefono", i < 2);
    });
  }
  const info = await resumirNius(env, [...new Set(found.map((f) => f.niu))]);
  const resultados = found
    .filter((f) => {
      const i = info.get(f.niu)!;
      if (f.exacto || f.por === "niu") return true;
      if (f.por === "dui") return i.duis.includes(dui);
      return i.telefonos.some((t) => telefonoSV(t) === tel);
    })
    // Una vez cada cliente (con el primer motivo confirmado: NIU, DUI y luego teléfono).
    .filter((f, k, all) => all.findIndex((g) => g.niu === f.niu) === k)
    .slice(0, MAX_RESULTADOS)
    .map((f) => sinTelefonos({ ...info.get(f.niu)!, por: f.por }));
  return { tipo: "telefono", resultados };
}

export function registerClientes(r: Router): void {
  r.on("GET", "/clientes/buscar", "datos:ver", async ({ env, url }) => {
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
    if (!q) throw new HttpError(400, "Escribe un nombre, un teléfono o un NIU.");
    return json({ ok: true, ...(await buscarClientes(env, q)) });
  });

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
