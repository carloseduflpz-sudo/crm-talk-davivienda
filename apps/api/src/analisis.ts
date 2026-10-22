/* Análisis de una campaña en un mes, calculado en la base con los archivos VIGENTES.
   Definiciones (las mismas de la versión 1):
   - Aprobación = aprobadas ÷ (aprobadas + rechazadas).
   - Contactabilidad = llamadas con contacto efectivo ÷ llamadas. Contacto efectivo =
     venta + negativo (+ no efectivo, según la regla de la campaña; por defecto sí).
   - Registros = clientes (NIU) distintos llamados.
   - Penetración = clientes con venta en VICI ÷ clientes únicos de la base del mes.
   - Cumplimiento = ventas de la sábana del mes ÷ meta; ritmo = ventas ÷ día del mes de la
     última venta; proyección = ritmo × días del mes. */
import {
  DEFAULT_WORK_DAYS,
  GOAL_UNIT,
  businessDays,
  countsForGoal,
  daysInMonth,
  isCampaignCode,
  suggestedHolidays,
  type CampaignAnalysis,
  type CampaignCode,
  type Count,
  type MonthSummary,
} from "@crm/core";
import { loadAgentNaming } from "./agentes";
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
  is_addition: number;
  label: string | null;
}

const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);

interface GoalRow {
  sales_goal: number | null;
  agents: number | null;
  counted_statuses: string | null;
  work_days: string | null;
  holidays: string | null;
}
/** Lista JSON guardada (o null si no hay). */
function parseList(v: string | null | undefined): string[] | null {
  if (!v) return null;
  try {
    const x = JSON.parse(v) as unknown;
    return Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : null;
  } catch {
    return null;
  }
}
function parseDays(v: string | null | undefined): number[] {
  const d = (v ?? "")
    .split(",")
    .map(Number)
    .filter((x) => Number.isInteger(x) && x >= 0 && x <= 6);
  return d.length ? [...new Set(d)].sort() : [...DEFAULT_WORK_DAYS];
}
const n = (v: unknown) => Number(v ?? 0);
const placeholders = (k: number) => Array.from({ length: k }, () => "?").join(", ");

/** Ventas y monto acumulados por día del mes (solo fechas de ese mes). */
function acumulado(month: string, porDia: { date: string; ventas: number; monto: number }[]): { ventas: number[]; monto: number[] } {
  const days = daysInMonth(month);
  const v = new Array<number>(days).fill(0);
  const m = new Array<number>(days).fill(0);
  for (const d of porDia) {
    if (!d.date.startsWith(month)) continue;
    const i = Number(d.date.slice(8, 10)) - 1;
    if (i >= 0 && i < days) (v[i]! += d.ventas), (m[i]! += d.monto);
  }
  for (let i = 1; i < days; i++) (v[i]! += v[i - 1]!), (m[i]! += m[i - 1]!);
  return { ventas: v, monto: m.map((x) => Math.round(x * 100) / 100) };
}

export async function analyzeCampaign(env: Env, campaign: string, requestedMonth: string | null, agente: string | null = null): Promise<CampaignAnalysis> {
  const db = env.DB;
  // Nombre homologado del agente (la herramienta une sola las formas distintas de escribir a la misma persona).
  const naming = await loadAgentNaming(env, campaign);
  const agentLabel = naming.sql;
  // Filtro opcional por agente: se agrega a cada consulta de ventas, llamadas y CRM.
  const fa = (col: string) => (agente ? ` AND ${agentLabel(col)} = ?` : "");
  const fb: string[] = agente ? [agente] : [];
  const { results: current } = await db
    .prepare("SELECT id, dataset, kind, month, rows_valid, version, created_at, created_by, is_addition, label FROM uploads WHERE campaign = ? AND is_current = 1")
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
    agentesUnidos: [],
    loaded: ofMonth.map((u) => ({ dataset: u.dataset, kind: u.kind, rows: u.rows_valid, version: u.version, createdAt: u.created_at, createdBy: u.created_by })),
    fechas: { hasta: null, fuera: [] },
    ventas: null,
    base: null,
    llamadas: null,
    crm: null,
    cumplimiento: {
      meta: null,
      agentes: null,
      metaPorAgente: null,
      unidad: isCampaignCode(campaign) ? GOAL_UNIT[campaign] : "ventas",
      ventas: 0,
      ventasTotales: 0,
      operaciones: 0,
      operacionesTotales: 0,
      aprobadas: 0,
      avance: null,
      faltan: null,
      fechaCorte: null,
      diaDelMes: 0,
      diasDelMes: 0,
      diasRestantes: 0,
      ritmoDiario: 0,
      proyeccion: 0,
      ritmoNecesario: null,
      esperado: null,
      avanceMTD: null,
      porAgente: [],
      config: { estatus: [], estatusPorDefecto: true, diasSemana: [...DEFAULT_WORK_DAYS], feriados: [] },
      estatusDisponibles: [],
      feriadosSugeridos: month ? suggestedHolidays(month) : [],
    },
  };

  /* ---------- fechas: hasta qué día llegan los datos y filas de otros meses ---------- */
  if (month) {
    type Dated = ["sabana" | "tipif" | "ventas", CurrentUpload | undefined, string, string];
    const dated = (
      [
        ["sabana", sabana, "bank_sales", "sale_date"],
        ["tipif", tipif, "calls", "called_at"],
        ["ventas", crm, "crm_sales", "entered_at"],
      ] as Dated[]
    ).filter((x): x is ["sabana" | "tipif" | "ventas", CurrentUpload, string, string] => Boolean(x[1]));
    if (dated.length) {
      const res = await db.batch(
        dated.map(([, u, table, col]) =>
          db
            .prepare(
              `SELECT MAX(CASE WHEN substr(${col}, 1, 7) = ?1 THEN substr(${col}, 1, 10) END) AS hasta,
                      SUM(CASE WHEN ${col} GLOB '20[0-9][0-9]-[0-9][0-9]*' AND substr(${col}, 1, 7) <> ?1 THEN 1 ELSE 0 END) AS fuera,
                      GROUP_CONCAT(DISTINCT CASE WHEN ${col} GLOB '20[0-9][0-9]-[0-9][0-9]*' AND substr(${col}, 1, 7) <> ?1 THEN substr(${col}, 1, 7) END) AS meses
                 FROM ${table} WHERE upload_id = ?2`,
            )
            .bind(month, u.id),
        ),
      );
      let hasta: string | null = null;
      res.forEach((r, i) => {
        const row = r.results[0] as { hasta: string | null; fuera: number | null; meses: string | null } | undefined;
        if (row?.hasta && (!hasta || row.hasta > hasta)) hasta = row.hasta;
        if (n(row?.fuera) > 0) out.fechas.fuera.push({ kind: dated[i]![0], filas: n(row!.fuera), meses: (row!.meses ?? "").split(",").filter(Boolean).sort() });
      });
      out.fechas.hasta = hasta;
    }
  }

  /* ---------- ventas (sábana del banco) ---------- */
  if (sabana) {
    const id = sabana.id;
    const [totals, estatus, ejecutivos, motivos, dias, procesos, mensual] = await db.batch([
      db.prepare(`SELECT status_class AS c, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS m FROM bank_sales WHERE upload_id = ?${fa("executive")} GROUP BY status_class`).bind(id, ...fb),
      db
        .prepare(
          `SELECT COALESCE(NULLIF(TRIM(status_raw), ''), '(sin estatus)') AS label, status_class AS c, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS m FROM bank_sales WHERE upload_id = ?${fa("executive")} GROUP BY 1, 2 ORDER BY n DESC LIMIT 25`,
        )
        .bind(id, ...fb),
      db
        .prepare(
          `SELECT ${agentLabel("executive")} AS agent, COUNT(*) AS ventas,
                  SUM(status_class = 'aprobado') AS aprobadas, SUM(status_class = 'rechazado') AS rechazadas,
                  COALESCE(SUM(amount), 0) AS monto, COALESCE(SUM(CASE WHEN status_class = 'aprobado' THEN amount END), 0) AS monto_aprobado
             FROM bank_sales WHERE upload_id = ?${fa("executive")} GROUP BY 1 ORDER BY ventas DESC`,
        )
        .bind(id, ...fb),
      db
        .prepare(
          `SELECT COALESCE(NULLIF(TRIM(reason), ''), 'Sin motivo especificado') AS label, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS m FROM bank_sales WHERE upload_id = ?${fa("executive")} AND status_class = 'rechazado' GROUP BY 1 ORDER BY n DESC LIMIT 15`,
        )
        .bind(id, ...fb),
      db
        .prepare(
          `SELECT sale_date AS d, COUNT(*) AS ventas, SUM(status_class = 'aprobado') AS aprobadas, COALESCE(SUM(amount), 0) AS monto,
                  COALESCE(SUM(CASE WHEN status_class = 'aprobado' THEN amount END), 0) AS monto_aprobado FROM bank_sales WHERE upload_id = ?${fa("executive")} AND sale_date IS NOT NULL GROUP BY sale_date ORDER BY sale_date`,
        )
        .bind(id, ...fb),
      db.prepare(`SELECT process AS label, COUNT(*) AS n FROM bank_sales WHERE upload_id = ?${fa("executive")} AND process IS NOT NULL GROUP BY process ORDER BY n DESC`).bind(id, ...fb),
      db
        .prepare(
          `SELECT u.month AS month, COUNT(*) AS ventas, SUM(b.status_class = 'aprobado') AS aprobadas,
                  SUM(b.status_class = 'rechazado') AS rechazadas, SUM(b.status_class = 'en_proceso') AS en_proceso,
                  COALESCE(SUM(b.amount), 0) AS monto, COALESCE(SUM(CASE WHEN b.status_class = 'aprobado' THEN b.amount END), 0) AS monto_aprobado
             FROM bank_sales b JOIN uploads u ON u.id = b.upload_id
            WHERE u.campaign = ? AND u.is_current = 1 AND u.kind = 'sabana'${fa("b.executive")}
            GROUP BY u.month ORDER BY u.month`,
        )
        .bind(campaign, ...fb),
    ]);
    const byClass = Object.fromEntries((totals!.results as { c: string; n: number }[]).map((r) => [r.c, n(r.n)]));
    const montoByClass = Object.fromEntries((totals!.results as { c: string; m: number }[]).map((r) => [r.c, n(r.m)]));
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
      monto: {
        total: Object.values(montoByClass).reduce((x, y) => x + y, 0),
        aprobado: montoByClass.aprobado ?? 0,
        rechazado: montoByClass.rechazado ?? 0,
        enProceso: montoByClass.en_proceso ?? 0,
      },
      porEstatus: (estatus!.results as { label: string; c: string; n: number; m: number }[]).map((r) => ({ label: r.label, class: r.c, value: n(r.n), monto: n(r.m) })),
      porEjecutivo: (ejecutivos!.results as { agent: string; ventas: number; aprobadas: number; rechazadas: number; monto: number; monto_aprobado: number }[]).map((r) => ({
        agent: r.agent,
        ventas: n(r.ventas),
        aprobadas: n(r.aprobadas),
        rechazadas: n(r.rechazadas),
        aprobacion: pct(n(r.aprobadas), n(r.aprobadas) + n(r.rechazadas)),
        monto: n(r.monto),
        montoAprobado: n(r.monto_aprobado),
      })),
      rechazoPorMotivo: (motivos!.results as { label: string; n: number; m: number }[]).map((r) => ({ label: r.label, value: n(r.n), monto: n(r.m) })),
      porDia: (dias!.results as { d: string; ventas: number; aprobadas: number; monto: number; monto_aprobado: number }[]).map((r) => ({
        date: r.d,
        ventas: n(r.ventas),
        aprobadas: n(r.aprobadas),
        monto: n(r.monto),
        montoAprobado: n(r.monto_aprobado),
      })),
      porProceso: (procesos!.results as { label: string; n: number }[]).map((r) => ({ label: r.label, value: n(r.n) })),
      mensual: (mensual!.results as { month: string; ventas: number; aprobadas: number; rechazadas: number; en_proceso: number; monto: number; monto_aprobado: number }[]).map((r) => ({
        month: r.month,
        ventas: n(r.ventas),
        aprobadas: n(r.aprobadas),
        rechazadas: n(r.rechazadas),
        enProceso: n(r.en_proceso),
        aprobacion: pct(n(r.aprobadas), n(r.aprobadas) + n(r.rechazadas)),
        monto: n(r.monto),
        montoAprobado: n(r.monto_aprobado),
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
    // Cada carga de base (original y adicionales, en orden de llegada): clientes nuevos que aportó
    // (los que no venían en una base anterior del mes) y cómo se trabajaron esos clientes.
    const ordered = [...bases].sort((x, y) => x.is_addition - y.is_addition || x.created_at - y.created_at);
    const effSql = efectivoSql.replace(/call_class/g, "c.call_class");
    const perUpload = ordered.map((u, i) => {
      const earlier = ordered.slice(0, i).map((x) => x.id);
      const notEarlier = earlier.length ? ` AND niu NOT IN (SELECT niu FROM base_records WHERE upload_id IN (${placeholders(earlier.length)}))` : "";
      return db
        .prepare(
          `WITH b AS (SELECT DISTINCT niu FROM base_records WHERE upload_id = ?${notEarlier})
           SELECT (SELECT COUNT(*) FROM base_records WHERE upload_id = ?) AS registros,
                  (SELECT COUNT(DISTINCT niu) FROM base_records WHERE upload_id = ?) AS unicos,
                  (SELECT COUNT(*) FROM b) AS nuevos,
                  (SELECT COUNT(DISTINCT c.niu) FROM calls c JOIN b ON b.niu = c.niu WHERE c.upload_id = ?${fa("c.agent")}) AS llamados,
                  (SELECT COUNT(DISTINCT c.niu) FROM calls c JOIN b ON b.niu = c.niu WHERE c.upload_id = ?${fa("c.agent")} AND ${effSql}) AS contactados,
                  (SELECT COUNT(DISTINCT s.niu) FROM bank_sales s JOIN b ON b.niu = s.niu WHERE s.upload_id = ?${fa("s.executive")}) AS ventas,
                  (SELECT COUNT(DISTINCT s.niu) FROM bank_sales s JOIN b ON b.niu = s.niu WHERE s.upload_id = ?${fa("s.executive")} AND s.status_class = 'aprobado') AS aprobadas`,
        )
        .bind(u.id, ...earlier, u.id, u.id, tipif?.id ?? null, ...fb, tipif?.id ?? null, ...fb, sabana?.id ?? null, ...fb, sabana?.id ?? null, ...fb);
    });
    const [porArchivo, unicos, historial, perfiles, ...cargas] = await db.batch([...stmts, ...perUpload]);
    baseUnicos = n((unicos!.results[0] as { n: number } | undefined)?.n);
    const porCarga = ordered.map((u, i) => {
      const r = cargas[i]!.results[0] as Record<string, number>;
      const nuevos = n(r.nuevos);
      return {
        uploadId: u.id,
        dataset: u.dataset,
        adicional: Boolean(u.is_addition),
        nombre: u.label,
        llegada: u.created_at,
        registros: n(r.registros),
        unicos: n(r.unicos),
        nuevos,
        repetidos: n(r.unicos) - nuevos,
        llamados: n(r.llamados),
        contactados: n(r.contactados),
        ventas: n(r.ventas),
        aprobadas: n(r.aprobadas),
        penetracion: pct(n(r.ventas), nuevos),
      };
    });
    out.base = {
      total: baseUnicos,
      porCarga,
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
          `SELECT ${agentLabel("agent")} AS agent, COUNT(*) AS llamadas, COUNT(DISTINCT NULLIF(niu, '')) AS registros,
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
      db.prepare(`SELECT ${agentLabel("agent")} AS label, COUNT(*) AS n FROM crm_sales WHERE upload_id = ?${fa("agent")} GROUP BY 1 ORDER BY n DESC`).bind(crm.id, ...fb),
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
  // Para que se vea qué nombres se unieron (solo los agentes de este mes).
  const present = new Set(out.agentes);
  out.agentesUnidos = naming.groups
    .filter((g) => present.has(g.name) && (g.variants.length > 1 || g.variants[0] !== g.name))
    .map((g) => ({ nombre: g.name, variantes: g.variants }));

  /* ---------- cumplimiento ---------- */
  if (month) {
    const c = out.cumplimiento;
    // Meta del mes; si aún no hay, la configuración del último mes con meta sirve de punto de partida.
    const goal = await db
      .prepare("SELECT sales_goal, agents, counted_statuses, work_days, holidays FROM goals WHERE campaign = ? AND month = ?")
      .bind(campaign, month)
      .first<GoalRow>();
    const base =
      goal ??
      (await db
        .prepare("SELECT NULL AS sales_goal, NULL AS agents, counted_statuses, work_days, '[]' AS holidays FROM goals WHERE campaign = ? AND month < ? ORDER BY month DESC LIMIT 1")
        .bind(campaign, month)
        .first<GoalRow>());
    const savedStatuses = parseList(base?.counted_statuses);
    c.config = {
      estatus: [],
      estatusPorDefecto: savedStatuses === null,
      diasSemana: parseDays(base?.work_days),
      feriados: (parseList(goal?.holidays) ?? []).filter((d) => d.startsWith(month)),
    };
    c.meta = goal ? n(goal.sales_goal) : null;
    c.agentes = goal?.agents ?? null;
    c.metaPorAgente = c.meta !== null && c.agentes ? c.meta / c.agentes : null;
    // Con filtro por agente, la meta que se mide es la individual.
    if (agente) c.meta = c.metaPorAgente;

    const habiles = businessDays(month, c.config.diasSemana, c.config.feriados);
    c.diasDelMes = habiles.length;

    if (sabana) {
      const label = "COALESCE(NULLIF(TRIM(status_raw), ''), '(sin estatus)')";
      const { results: estatus } = await db
        .prepare(`SELECT ${label} AS label, COUNT(*) AS n, COALESCE(SUM(amount), 0) AS monto FROM bank_sales WHERE upload_id = ?${fa("executive")} GROUP BY 1 ORDER BY n DESC`)
        .bind(sabana.id, ...fb)
        .all<{ label: string; n: number; monto: number }>();
      const cuenta = (l: string) => (savedStatuses ? savedStatuses.includes(l) : countsForGoal(campaign as CampaignCode, l));
      c.estatusDisponibles = estatus.map((r) => ({ label: r.label, value: n(r.n), monto: n(r.monto), cuenta: cuenta(r.label) }));
      // Los guardados se respetan aunque este mes no aparezcan; los de la regla, solo los presentes.
      c.config.estatus = savedStatuses ?? c.estatusDisponibles.filter((e) => e.cuenta).map((e) => e.label);
      const counted = c.config.estatus;
      const inList = counted.length ? `${label} IN (${placeholders(counted.length)})` : "0";
      // CDC y Extra se miden en dólares: se suma el monto de la sábana en vez de contar ventas.
      const measure = c.unidad === "monto" ? "COALESCE(amount, 0)" : "1";
      const [porAgente, porDia] = await db.batch([
        db
          .prepare(
            `SELECT ${agentLabel("executive")} AS agent, SUM(${measure}) AS total, SUM(CASE WHEN ${inList} THEN ${measure} ELSE 0 END) AS ventas,
                    SUM(${inList}) AS operaciones, COUNT(*) AS operaciones_total, SUM(status_class = 'aprobado') AS aprobadas
               FROM bank_sales WHERE upload_id = ?${fa("executive")} GROUP BY 1 ORDER BY ventas DESC, total DESC`,
          )
          .bind(...counted, ...counted, sabana.id, ...fb), // la lista aparece dos veces en el SELECT
        db.prepare(`SELECT MAX(sale_date) AS corte FROM bank_sales WHERE upload_id = ?${fa("executive")} AND sale_date LIKE ?`).bind(sabana.id, ...fb, `${month}%`),
      ]);
      const agentes = porAgente!.results as { agent: string; total: number; ventas: number; operaciones: number; operaciones_total: number; aprobadas: number }[];
      c.ventas = agentes.reduce((sum, r) => sum + n(r.ventas), 0);
      c.ventasTotales = agentes.reduce((sum, r) => sum + n(r.total), 0);
      c.operaciones = agentes.reduce((sum, r) => sum + n(r.operaciones), 0);
      c.operacionesTotales = agentes.reduce((sum, r) => sum + n(r.operaciones_total), 0);
      c.aprobadas = agentes.reduce((sum, r) => sum + n(r.aprobadas), 0);
      c.fechaCorte = (porDia!.results[0] as { corte: string | null } | undefined)?.corte ?? null;
      c.diaDelMes = c.fechaCorte ? habiles.filter((d) => d <= c.fechaCorte!).length : 0;
      c.diasRestantes = c.diasDelMes - c.diaDelMes;
      c.ritmoDiario = c.diaDelMes ? c.ventas / c.diaDelMes : 0;
      c.proyeccion = Math.round(c.ventas + c.ritmoDiario * c.diasRestantes);
      c.porAgente = agentes.map((r) => ({
        agent: r.agent,
        ventas: n(r.ventas),
        total: n(r.total),
        operaciones: n(r.operaciones),
        aprobadas: n(r.aprobadas),
        meta: c.metaPorAgente,
        gap: c.metaPorAgente !== null ? c.metaPorAgente - n(r.ventas) : null,
        avance: c.metaPorAgente ? pct(n(r.ventas), c.metaPorAgente) : null,
        metaMTD: null,
        gapMTD: null,
        avanceMTD: null,
      }));
    } else {
      c.config.estatus = savedStatuses ?? [];
    }
    if (c.meta !== null) {
      c.avance = pct(c.ventas, c.meta);
      c.faltan = Math.max(0, c.meta - c.ventas);
      c.ritmoNecesario = c.diasRestantes > 0 ? c.faltan / c.diasRestantes : null;
      // MTD: la meta repartida por días hábiles hasta la fecha de corte.
      c.esperado = c.diasDelMes ? (c.meta * c.diaDelMes) / c.diasDelMes : null;
      c.avanceMTD = c.esperado ? pct(c.ventas, c.esperado) : null;
    }
    const share = c.diasDelMes ? c.diaDelMes / c.diasDelMes : 0;
    for (const r of c.porAgente) {
      if (r.meta === null) continue;
      r.metaMTD = r.meta * share;
      r.gapMTD = r.metaMTD - r.ventas;
      r.avanceMTD = r.metaMTD ? pct(r.ventas, r.metaMTD) : null;
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

  /** Histórico: un resumen por mes con los archivos vigentes de cada mes (mismo cálculo que cada pestaña). */
  r.on("GET", "/analisis/:campaign/historico", "datos:ver", async ({ env, params, url }) => {
    const campaign = params.campaign!;
    if (!isCampaignCode(campaign)) throw new HttpError(404, "Campaña desconocida.");
    const agente = url.searchParams.get("agente")?.trim() || null;
    if (agente && agente.length > 120) throw new HttpError(400, "Nombre de agente inválido.");
    const first = await analyzeCampaign(env, campaign, null, agente);
    const months = first.months.slice(0, 13);
    const all = [first, ...(await Promise.all(months.slice(1).map((m) => analyzeCampaign(env, campaign, m, agente))))];
    const summary: MonthSummary[] = all
      .filter((a): a is CampaignAnalysis & { month: string } => Boolean(a.month))
      .map((a) => {
        const c = a.cumplimiento;
        return {
          month: a.month,
          ventas: a.ventas?.total ?? null,
          aprobadas: a.ventas?.aprobadas ?? null,
          rechazadas: a.ventas?.rechazadas ?? null,
          aprobacion: a.ventas ? a.ventas.aprobacion : null,
          monto: a.ventas ? a.ventas.monto.total : null,
          montoAprobado: a.ventas ? a.ventas.monto.aprobado : null,
          base: a.base?.total ?? null,
          adicionales: a.base?.porCarga.filter((x) => x.adicional).length ?? 0,
          llamadas: a.llamadas?.total ?? null,
          registros: a.llamadas?.registros ?? null,
          contactabilidad: a.llamadas?.contactabilidad ?? null,
          ventasVici: a.llamadas?.ventasUnicas ?? null,
          penetracion: a.llamadas?.penetracion ?? null,
          unidad: c.unidad,
          meta: c.meta,
          logrado: a.ventas ? c.ventas : null,
          cumplimiento: c.meta !== null && a.ventas ? c.avance : null,
          diasHabiles: c.diasDelMes,
          hasta: a.fechas.hasta,
          acumulado: acumulado(a.month, a.ventas?.porDia ?? []),
        };
      })
      .sort((x, y) => x.month.localeCompare(y.month));
    return json({ ok: true, agente, meses: summary });
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
    // Configuración: qué estatus cuentan (null = regla por defecto), días hábiles y feriados.
    const statuses = b.countedStatuses ?? null;
    if (statuses !== null && (!Array.isArray(statuses) || statuses.length > 100 || statuses.some((x) => typeof x !== "string" || x.length > 120))) {
      throw new HttpError(400, "La lista de estatus que cuentan no es válida.");
    }
    const workDays = b.workDays ?? [...DEFAULT_WORK_DAYS];
    if (!Array.isArray(workDays) || !workDays.length || workDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new HttpError(400, "Elige al menos un día de la semana que se trabaje.");
    }
    const holidays = b.holidays ?? [];
    if (!Array.isArray(holidays) || holidays.length > 31 || holidays.some((d) => typeof d !== "string" || !d.startsWith(month) || !/^\d{4}-\d{2}-\d{2}$/.test(d))) {
      throw new HttpError(400, "Los feriados deben ser fechas del mismo mes.");
    }
    // CDC y Extra ponen la meta en dólares: se permiten montos grandes y centavos.
    if (typeof goal !== "number" || !Number.isFinite(goal) || goal < 0 || goal > 1_000_000_000) throw new HttpError(400, "La meta debe ser un número positivo.");
    if (agents !== null && (typeof agents !== "number" || !Number.isInteger(agents) || agents < 1 || agents > 1000)) {
      throw new HttpError(400, "El número de agentes debe ser un entero mayor que cero.");
    }
    await env.DB.prepare(
      `INSERT INTO goals (campaign, month, sales_goal, agents, counted_statuses, work_days, holidays, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (campaign, month) DO UPDATE SET sales_goal = excluded.sales_goal, agents = excluded.agents,
         counted_statuses = excluded.counted_statuses, work_days = excluded.work_days, holidays = excluded.holidays,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    )
      .bind(
        campaign,
        month,
        goal,
        agents,
        statuses === null ? null : JSON.stringify([...new Set(statuses.map((x: string) => x.trim()))]),
        [...new Set(workDays as number[])].sort().join(","),
        JSON.stringify([...new Set(holidays as string[])].sort()),
        user.username,
        Date.now(),
      )
      .run();
    await audit(env, user.username, "meta_actualizada", `${campaign}:${month}`, { meta: goal, agentes: agents, estatus: statuses, diasSemana: workDays, feriados: holidays });
    return json({ ok: true });
  });
}
