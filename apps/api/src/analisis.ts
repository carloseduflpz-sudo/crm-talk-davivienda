/* Análisis de una campaña en un mes, calculado en la base con los archivos VIGENTES.
   Definiciones (las mismas de la versión 1):
   - Aprobación = aprobadas ÷ (aprobadas + rechazadas).
   - Contactabilidad = llamadas con contacto efectivo ÷ llamadas. Contacto efectivo =
     venta + negativo (+ no efectivo, según la regla de la campaña; por defecto sí).
   - Registros = clientes (NIU) distintos llamados.
   - Penetración = clientes con venta en VICI ÷ clientes únicos de la base del mes.
   - Cumplimiento = ventas de la sábana del mes ÷ meta; ritmo = ventas ÷ día del mes de la
     última venta; proyección = ritmo × días del mes. */
import { isCampaignCode, type CampaignAnalysis, type Count } from "@crm/core";
import { audit } from "./audit";
import type { Env } from "./env";
import { HttpError, json, readJson, requireString, type Router } from "./http";

interface CurrentUpload {
  id: string;
  dataset: string;
  kind: string;
  month: string;
  rows_valid: number;
  version: number;
  created_at: number;
  created_by: string;
}

const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const n = (v: unknown) => Number(v ?? 0);
const placeholders = (k: number) => Array.from({ length: k }, () => "?").join(", ");
/** Nombre del agente tal como se agrupa en todos los análisis (vacío = "Sin asignar"). */
export const agentLabel = (col: string) => `COALESCE(NULLIF(TRIM(${col}), ''), 'Sin asignar')`;

export async function analyzeCampaign(env: Env, campaign: string, requestedMonth: string | null, agente: string | null = null): Promise<CampaignAnalysis> {
  const db = env.DB;
  // Filtro opcional por agente: se agrega a cada consulta de ventas, llamadas y CRM.
  const fa = (col: string) => (agente ? ` AND ${agentLabel(col)} = ?` : "");
  const fb: string[] = agente ? [agente] : [];
  const { results: current } = await db
    .prepare("SELECT id, dataset, kind, month, rows_valid, version, created_at, created_by FROM uploads WHERE campaign = ? AND is_current = 1")
    .bind(campaign)
    .all<CurrentUpload>();
  const months = [...new Set(current.map((u) => u.month))].sort().reverse();
  const month = requestedMonth && months.includes(requestedMonth) ? requestedMonth : (months[0] ?? null);
  const ofMonth = current.filter((u) => u.month === month);
  const sabana = ofMonth.find((u) => u.kind === "sabana");
  const tipif = ofMonth.find((u) => u.kind === "tipif");
  const crm = ofMonth.find((u) => u.kind === "ventas");
  const bases = ofMonth.filter((u) => u.kind === "base");

  const rule =
    (await db.prepare("SELECT contact_rule FROM campaigns WHERE code = ?").bind(campaign).first<{ contact_rule: string }>())?.contact_rule === "sin_no_efectivo"
      ? "sin_no_efectivo"
      : "con_no_efectivo";
  const efectivoSql = rule === "con_no_efectivo" ? "call_class IN ('venta','negativo','no_efectivo')" : "call_class IN ('venta','negativo')";

  const out: CampaignAnalysis = {
    campaign,
    month,
    months,
    agente,
    agentes: [],
    loaded: ofMonth.map((u) => ({ dataset: u.dataset, kind: u.kind, rows: u.rows_valid, version: u.version, createdAt: u.created_at, createdBy: u.created_by })),
    ventas: null,
    base: null,
    llamadas: null,
    crm: null,
    cumplimiento: {
      meta: null,
      agentes: null,
      metaPorAgente: null,
      ventas: 0,
      aprobadas: 0,
      avance: null,
      faltan: null,
      diaDelMes: 0,
      diasDelMes: month ? new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate() : 30,
      ritmoDiario: 0,
      proyeccion: 0,
      ritmoNecesario: null,
      porAgente: [],
    },
  };

  /* ---------- ventas (sábana del banco) ---------- */
  if (sabana) {
    const id = sabana.id;
    const [totals, estatus, ejecutivos, motivos, dias, procesos, mensual] = await db.batch([
      db.prepare(`SELECT status_class AS c, COUNT(*) AS n FROM bank_sales WHERE upload_id = ?${fa("executive")} GROUP BY status_class`).bind(id, ...fb),
      db
        .prepare(
          `SELECT COALESCE(NULLIF(TRIM(status_raw), ''), '(sin estatus)') AS label, status_class AS c, COUNT(*) AS n FROM bank_sales WHERE upload_id = ?${fa("executive")} GROUP BY 1, 2 ORDER BY n DESC LIMIT 25`,
        )
        .bind(id, ...fb),
      db
        .prepare(
          `SELECT COALESCE(NULLIF(TRIM(executive), ''), 'Sin asignar') AS agent, COUNT(*) AS ventas,
                  SUM(status_class = 'aprobado') AS aprobadas, SUM(status_class = 'rechazado') AS rechazadas
             FROM bank_sales WHERE upload_id = ?${fa("executive")} GROUP BY 1 ORDER BY ventas DESC`,
        )
        .bind(id, ...fb),
      db
        .prepare(
          `SELECT COALESCE(NULLIF(TRIM(reason), ''), 'Sin motivo especificado') AS label, COUNT(*) AS n FROM bank_sales WHERE upload_id = ?${fa("executive")} AND status_class = 'rechazado' GROUP BY 1 ORDER BY n DESC LIMIT 15`,
        )
        .bind(id, ...fb),
      db
        .prepare(
          `SELECT sale_date AS d, COUNT(*) AS ventas, SUM(status_class = 'aprobado') AS aprobadas FROM bank_sales WHERE upload_id = ?${fa("executive")} AND sale_date IS NOT NULL GROUP BY sale_date ORDER BY sale_date`,
        )
        .bind(id, ...fb),
      db.prepare(`SELECT process AS label, COUNT(*) AS n FROM bank_sales WHERE upload_id = ?${fa("executive")} AND process IS NOT NULL GROUP BY process ORDER BY n DESC`).bind(id, ...fb),
      db
        .prepare(
          `SELECT u.month AS month, COUNT(*) AS ventas, SUM(b.status_class = 'aprobado') AS aprobadas,
                  SUM(b.status_class = 'rechazado') AS rechazadas, SUM(b.status_class = 'en_proceso') AS en_proceso
             FROM bank_sales b JOIN uploads u ON u.id = b.upload_id
            WHERE u.campaign = ? AND u.is_current = 1 AND u.kind = 'sabana'${fa("b.executive")}
            GROUP BY u.month ORDER BY u.month`,
        )
        .bind(campaign, ...fb),
    ]);
    const byClass = Object.fromEntries((totals!.results as { c: string; n: number }[]).map((r) => [r.c, n(r.n)]));
    const aprobadas = byClass.aprobado ?? 0;
    const rechazadas = byClass.rechazado ?? 0;
    const enProceso = byClass.en_proceso ?? 0;
    const total = aprobadas + rechazadas + enProceso;
    out.ventas = {
      total,
      aprobadas,
      rechazadas,
      enProceso,
      aprobacion: pct(aprobadas, aprobadas + rechazadas),
      porEstatus: (estatus!.results as { label: string; c: string; n: number }[]).map((r) => ({ label: r.label, class: r.c, value: n(r.n) })),
      porEjecutivo: (ejecutivos!.results as { agent: string; ventas: number; aprobadas: number; rechazadas: number }[]).map((r) => ({
        agent: r.agent,
        ventas: n(r.ventas),
        aprobadas: n(r.aprobadas),
        rechazadas: n(r.rechazadas),
        aprobacion: pct(n(r.aprobadas), n(r.aprobadas) + n(r.rechazadas)),
      })),
      rechazoPorMotivo: (motivos!.results as { label: string; n: number }[]).map((r) => ({ label: r.label, value: n(r.n) })),
      porDia: (dias!.results as { d: string; ventas: number; aprobadas: number }[]).map((r) => ({ date: r.d, ventas: n(r.ventas), aprobadas: n(r.aprobadas) })),
      porProceso: (procesos!.results as { label: string; n: number }[]).map((r) => ({ label: r.label, value: n(r.n) })),
      mensual: (mensual!.results as { month: string; ventas: number; aprobadas: number; rechazadas: number; en_proceso: number }[]).map((r) => ({
        month: r.month,
        ventas: n(r.ventas),
        aprobadas: n(r.aprobadas),
        rechazadas: n(r.rechazadas),
        enProceso: n(r.en_proceso),
        aprobacion: pct(n(r.aprobadas), n(r.aprobadas) + n(r.rechazadas)),
      })),
    };
  }

  /* ---------- base ---------- */
  const baseIds = bases.map((b) => b.id);
  let baseUnicos = 0;
  if (baseIds.length) {
    const inIds = placeholders(baseIds.length);
    const stmts = [
      db.prepare(`SELECT dataset, COUNT(*) AS registros, COUNT(DISTINCT niu) AS unicos FROM base_records WHERE upload_id IN (${inIds}) GROUP BY dataset`).bind(...baseIds),
      db.prepare(`SELECT COUNT(DISTINCT niu) AS n FROM base_records WHERE upload_id IN (${inIds})`).bind(...baseIds),
      db
        .prepare(
          `SELECT u.month AS month, u.dataset AS dataset, COUNT(DISTINCT b.niu) AS unicos
             FROM base_records b JOIN uploads u ON u.id = b.upload_id
            WHERE u.campaign = ? AND u.is_current = 1 AND u.kind = 'base' GROUP BY u.month, u.dataset ORDER BY u.month`,
        )
        .bind(campaign),
    ];
    // Perfiles de la base cruzados con la sábana del mismo mes.
    stmts.push(
      sabana
        ? db
            .prepare(
              `WITH b AS (SELECT niu, MAX(COALESCE(NULLIF(TRIM(profile), ''), 'N/D')) AS profile FROM base_records WHERE upload_id IN (${inIds}) GROUP BY niu),
                    s AS (SELECT niu, MAX(status_class = 'aprobado') AS apr, MAX(status_class = 'rechazado') AS rech FROM bank_sales WHERE upload_id = ?${fa("executive")} GROUP BY niu)
               SELECT b.profile AS profile, COUNT(*) AS base, COUNT(s.niu) AS con_venta, SUM(COALESCE(s.apr, 0)) AS aprobadas, SUM(COALESCE(s.rech, 0)) AS rechazadas
                 FROM b LEFT JOIN s ON s.niu = b.niu GROUP BY b.profile ORDER BY base DESC LIMIT 30`,
            )
            .bind(...baseIds, sabana.id, ...fb)
        : db
            .prepare(
              `SELECT profile, COUNT(*) AS base, 0 AS con_venta, 0 AS aprobadas, 0 AS rechazadas
                 FROM (SELECT niu, MAX(COALESCE(NULLIF(TRIM(profile), ''), 'N/D')) AS profile FROM base_records WHERE upload_id IN (${inIds}) GROUP BY niu)
                GROUP BY profile ORDER BY base DESC LIMIT 30`,
            )
            .bind(...baseIds),
    );
    const [porArchivo, unicos, historial, perfiles] = await db.batch(stmts);
    baseUnicos = n((unicos!.results[0] as { n: number } | undefined)?.n);
    out.base = {
      total: baseUnicos,
      porArchivo: (porArchivo!.results as { dataset: string; registros: number; unicos: number }[]).map((r) => ({ dataset: r.dataset, registros: n(r.registros), unicos: n(r.unicos) })),
      historial: (historial!.results as { month: string; dataset: string; unicos: number }[]).map((r) => ({ month: r.month, dataset: r.dataset, unicos: n(r.unicos) })),
      porPerfil: (perfiles!.results as { profile: string; base: number; con_venta: number; aprobadas: number; rechazadas: number }[]).map((r) => ({
        profile: r.profile,
        base: n(r.base),
        conVenta: n(r.con_venta),
        aprobadas: n(r.aprobadas),
        rechazadas: n(r.rechazadas),
        penetracion: pct(n(r.con_venta), n(r.base)),
      })),
    };
  }

  /* ---------- llamadas (VICI) ---------- */
  if (tipif) {
    const id = tipif.id;
    const [clases, unicos, agentes, tipologias, dias, intentos, estructura, ventasSeq] = await db.batch([
      db.prepare(`SELECT call_class AS label, COUNT(*) AS n FROM calls WHERE upload_id = ?${fa("agent")} GROUP BY call_class ORDER BY n DESC`).bind(id, ...fb),
      db.prepare(`SELECT COUNT(DISTINCT niu) AS n, COUNT(DISTINCT CASE WHEN call_class = 'venta' THEN niu END) AS ventas FROM calls WHERE upload_id = ?${fa("agent")} AND niu <> ''`).bind(id, ...fb),
      db
        .prepare(
          `SELECT COALESCE(NULLIF(TRIM(agent), ''), 'Sin asignar') AS agent, COUNT(*) AS llamadas, COUNT(DISTINCT NULLIF(niu, '')) AS registros,
                  SUM(${efectivoSql}) AS efectivos, SUM(call_class = 'venta') AS ventas, SUM(call_class = 'no_contacto') AS no_contacto
             FROM calls WHERE upload_id = ?${fa("agent")} GROUP BY 1 ORDER BY llamadas DESC`,
        )
        .bind(id, ...fb),
      db
        .prepare(
          `SELECT COALESCE(NULLIF(TRIM(tipologia), ''), 'Sin Tipificar') AS label, call_class AS c, COUNT(*) AS n FROM calls WHERE upload_id = ?${fa("agent")} GROUP BY 1, 2 ORDER BY n DESC LIMIT 20`,
        )
        .bind(id, ...fb),
      db
        .prepare(
          `SELECT substr(called_at, 1, 10) AS d, COUNT(*) AS llamadas, SUM(${efectivoSql}) AS efectivos
             FROM calls WHERE upload_id = ?${fa("agent")} AND called_at IS NOT NULL GROUP BY 1 ORDER BY 1`,
        )
        .bind(id, ...fb),
      db
        .prepare(
          `SELECT CASE WHEN k >= 6 THEN '6+' ELSE CAST(k AS TEXT) END AS intentos, COUNT(*) AS clientes
             FROM (SELECT niu, COUNT(*) AS k FROM calls WHERE upload_id = ?${fa("agent")} AND niu <> '' GROUP BY niu)
            GROUP BY 1 ORDER BY MIN(k)`,
        )
        .bind(id, ...fb),
      db
        .prepare(
          `SELECT SUM(seq = 1) AS primeros, SUM(seq > 1) AS seguimientos
             FROM (SELECT ROW_NUMBER() OVER (PARTITION BY niu ORDER BY called_at) AS seq FROM calls WHERE upload_id = ?${fa("agent")} AND niu <> '')`,
        )
        .bind(id, ...fb),
      db
        .prepare(
          `SELECT SUM(first_sale = 1) AS primero, SUM(first_sale > 1) AS rellamado FROM (
             SELECT niu, MIN(seq) AS first_sale FROM (
               SELECT niu, call_class, ROW_NUMBER() OVER (PARTITION BY niu ORDER BY called_at) AS seq FROM calls WHERE upload_id = ?${fa("agent")} AND niu <> ''
             ) WHERE call_class = 'venta' GROUP BY niu)`,
        )
        .bind(id, ...fb),
    ]);
    const clasesRows = (clases!.results as { label: string; n: number }[]).map((r) => ({ label: r.label, value: n(r.n) }));
    const total = clasesRows.reduce((s, r) => s + r.value, 0);
    const efectivos = clasesRows
      .filter((r) => r.label === "venta" || r.label === "negativo" || (rule === "con_no_efectivo" && r.label === "no_efectivo"))
      .reduce((s, r) => s + r.value, 0);
    const u = unicos!.results[0] as { n: number; ventas: number } | undefined;
    const est = estructura!.results[0] as { primeros: number; seguimientos: number } | undefined;
    const vs = ventasSeq!.results[0] as { primero: number; rellamado: number } | undefined;
    out.llamadas = {
      total,
      registros: n(u?.n),
      efectivos,
      contactabilidad: pct(efectivos, total),
      reglaContacto: rule,
      porClase: clasesRows,
      porAgente: (agentes!.results as { agent: string; llamadas: number; registros: number; efectivos: number; ventas: number; no_contacto: number }[]).map((r) => ({
        agent: r.agent,
        llamadas: n(r.llamadas),
        registros: n(r.registros),
        efectivos: n(r.efectivos),
        ventas: n(r.ventas),
        noContacto: n(r.no_contacto),
        contactabilidad: pct(n(r.efectivos), n(r.llamadas)),
      })),
      tipologias: (tipologias!.results as { label: string; c: string; n: number }[]).map((r) => ({ label: r.label, class: r.c, value: n(r.n) })),
      porDia: (dias!.results as { d: string; llamadas: number; efectivos: number }[]).map((r) => ({ date: r.d, llamadas: n(r.llamadas), efectivos: n(r.efectivos) })),
      intentos: (intentos!.results as { intentos: string; clientes: number }[]).map((r) => ({ intentos: r.intentos, clientes: n(r.clientes) })),
      primerContacto: n(est?.primeros),
      seguimiento: n(est?.seguimientos),
      ventasPrimerIntento: n(vs?.primero),
      ventasRellamado: n(vs?.rellamado),
      ventasUnicas: n(u?.ventas),
      penetracion: baseUnicos ? pct(n(u?.ventas), baseUnicos) : null,
    };
  }

  /* ---------- ventas capturadas en el CRM ---------- */
  if (crm) {
    const [tot, agentes, dias, match] = await db.batch([
      db.prepare(`SELECT COUNT(*) AS n FROM crm_sales WHERE upload_id = ?${fa("agent")}`).bind(crm.id, ...fb),
      db.prepare(`SELECT COALESCE(NULLIF(TRIM(agent), ''), 'Sin asignar') AS label, COUNT(*) AS n FROM crm_sales WHERE upload_id = ?${fa("agent")} GROUP BY 1 ORDER BY n DESC`).bind(crm.id, ...fb),
      db.prepare(`SELECT substr(entered_at, 1, 10) AS d, COUNT(*) AS n FROM crm_sales WHERE upload_id = ?${fa("agent")} AND entered_at IS NOT NULL GROUP BY 1 ORDER BY 1`).bind(crm.id, ...fb),
      sabana
        ? db.prepare(`SELECT COUNT(DISTINCT c.niu) AS n FROM crm_sales c WHERE c.upload_id = ?${fa("c.agent")} AND EXISTS (SELECT 1 FROM bank_sales b WHERE b.upload_id = ? AND b.niu = c.niu)`).bind(crm.id, ...fb, sabana.id)
        : db.prepare("SELECT NULL AS n"),
    ]);
    out.crm = {
      total: n((tot!.results[0] as { n: number } | undefined)?.n),
      conEstatusBanco: sabana ? n((match!.results[0] as { n: number } | undefined)?.n) : null,
      porAgente: (agentes!.results as { label: string; n: number }[]).map((r): Count => ({ label: r.label, value: n(r.n) })),
      porDia: (dias!.results as { d: string; n: number }[]).map((r) => ({ date: r.d, ventas: n(r.n) })),
    };
  }

  /* ---------- agentes del mes (para el filtro) ---------- */
  const sources: [string | undefined, string, string][] = [
    [sabana?.id, "bank_sales", "executive"],
    [tipif?.id, "calls", "agent"],
    [crm?.id, "crm_sales", "agent"],
  ];
  const withAgents = sources.filter((x): x is [string, string, string] => Boolean(x[0]));
  if (withAgents.length) {
    const { results } = await db
      .prepare(withAgents.map(([, t, col]) => `SELECT DISTINCT ${agentLabel(col)} AS a FROM ${t} WHERE upload_id = ?`).join(" UNION ") + " ORDER BY a")
      .bind(...withAgents.map(([id]) => id))
      .all<{ a: string }>();
    out.agentes = results.map((r) => r.a).sort((x, y) => x.localeCompare(y, "es"));
  }

  /* ---------- cumplimiento ---------- */
  if (month) {
    const goal = await db.prepare("SELECT sales_goal, agents FROM goals WHERE campaign = ? AND month = ?").bind(campaign, month).first<{ sales_goal: number; agents: number | null }>();
    const c = out.cumplimiento;
    c.meta = goal ? n(goal.sales_goal) : null;
    c.agentes = goal?.agents ?? null;
    c.metaPorAgente = c.meta !== null && c.agentes ? c.meta / c.agentes : null;
    // Con filtro por agente, la meta que se mide es la individual.
    if (agente) c.meta = c.metaPorAgente;
    if (out.ventas) {
      c.ventas = out.ventas.total;
      c.aprobadas = out.ventas.aprobadas;
      const lastDay = out.ventas.porDia.filter((d) => d.date.startsWith(month)).at(-1)?.date;
      c.diaDelMes = lastDay ? Number(lastDay.slice(8, 10)) : 0;
      c.ritmoDiario = c.diaDelMes ? c.ventas / c.diaDelMes : 0;
      c.proyeccion = Math.round(c.ritmoDiario * c.diasDelMes);
      c.porAgente = out.ventas.porEjecutivo.map((a) => ({
        agent: a.agent,
        ventas: a.ventas,
        aprobadas: a.aprobadas,
        meta: c.metaPorAgente,
        gap: c.metaPorAgente !== null ? c.metaPorAgente - a.ventas : null,
        avance: c.metaPorAgente ? pct(a.ventas, c.metaPorAgente) : null,
      }));
    }
    if (c.meta !== null) {
      c.avance = pct(c.ventas, c.meta);
      c.faltan = Math.max(0, c.meta - c.ventas);
      const restantes = c.diasDelMes - c.diaDelMes;
      c.ritmoNecesario = restantes > 0 ? c.faltan / restantes : null;
    }
  }

  return out;
}

export function registerAnalisis(r: Router): void {
  r.on("GET", "/analisis/:campaign", "datos:ver", async ({ env, params, url }) => {
    const campaign = params.campaign!;
    if (!isCampaignCode(campaign)) throw new HttpError(404, "Campaña desconocida.");
    const mes = url.searchParams.get("mes");
    if (mes && !/^20\d{2}-(0[1-9]|1[0-2])$/.test(mes)) throw new HttpError(400, "Mes inválido.");
    const agente = url.searchParams.get("agente")?.trim() || null;
    if (agente && agente.length > 120) throw new HttpError(400, "Nombre de agente inválido.");
    return json({ ok: true, analysis: await analyzeCampaign(env, campaign, mes, agente) });
  });

  /** Meta de ventas y número de agentes de una campaña en un mes. */
  r.on("PUT", "/metas", "config:editar", async ({ env, req, user }) => {
    const b = await readJson(req);
    const campaign = requireString(b, "campaign", "la campaña", 20);
    const month = requireString(b, "month", "el mes", 7);
    if (!isCampaignCode(campaign)) throw new HttpError(400, "Campaña desconocida.");
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "Mes inválido.");
    const goal = b.salesGoal;
    const agents = b.agents ?? null;
    if (typeof goal !== "number" || !Number.isInteger(goal) || goal < 0 || goal > 1_000_000) throw new HttpError(400, "La meta debe ser un número entero.");
    if (agents !== null && (typeof agents !== "number" || !Number.isInteger(agents) || agents < 1 || agents > 1000)) {
      throw new HttpError(400, "El número de agentes debe ser un entero mayor que cero.");
    }
    await env.DB.prepare(
      `INSERT INTO goals (campaign, month, sales_goal, agents, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (campaign, month) DO UPDATE SET sales_goal = excluded.sales_goal, agents = excluded.agents,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
      .bind(campaign, month, goal, agents, user.username, Date.now())
      .run();
    await audit(env, user.username, "meta_actualizada", `${campaign}:${month}`, { meta: goal, agentes: agents });
    return json({ ok: true });
  });
}
