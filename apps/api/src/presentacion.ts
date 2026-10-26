/* Presentación semanal: las cifras que lleva cada lámina, calculadas con los archivos vigentes del mes,
   y la plantilla (.pptx) guardada en R2 para que cada semana baste con darle "Descargar". */
import { isCampaignCode, semanaDe, type CampaignCode, type PresBase, type PresentacionCampania, type PresMesGap, type PresVenta } from "@crm/core";
import { analyzeCampaign } from "./analisis";
import { audit } from "./audit";
import type { Env } from "./env";
import { HttpError, json, type Router } from "./http";

const PLANTILLA = "presentacion/plantilla.pptx";
const MAX_PPTX = 60 * 1024 * 1024;
const MES = /^20\d{2}-(0[1-9]|1[0-2])$/;

const n = (v: unknown) => Number(v ?? 0);
const ph = (k: number) => Array.from({ length: k }, () => "?").join(", ");

interface Upload {
  id: string;
  dataset: string;
  kind: string;
  month: string;
}

const prevMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
};

/** Tipo de cuenta que trae la sábana de TDC ("PRIMERA CUENTA", "2DA", "1"…). */
function cuentaTdc(v: unknown): string | null {
  const s = String(v ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (!s) return null;
  if (/seg|(^|\D)2(\D|$)/.test(s)) return "tdc:base:segundas";
  if (/pri|(^|\D)1(\D|$)/.test(s)) return "tdc:base:primeras";
  return null;
}

export async function presentacionDatos(env: Env, campaign: CampaignCode, mes: string | null): Promise<PresentacionCampania | null> {
  const a = await analyzeCampaign(env, campaign, mes);
  if (!a.month) return null;
  const month = a.month;
  const db = env.DB;
  const { results: uploads } = await db
    .prepare("SELECT id, dataset, kind, month FROM uploads WHERE campaign = ? AND is_current = 1 AND month IN (?, ?)")
    .bind(campaign, month, prevMonth(month))
    .all<Upload>();
  const ofMonth = uploads.filter((u) => u.month === month);
  const sabana = ofMonth.find((u) => u.kind === "sabana");
  const tipif = ofMonth.find((u) => u.kind === "tipif");
  const rule = (await db.prepare("SELECT contact_rule FROM campaigns WHERE code = ?").bind(campaign).first<{ contact_rule: string }>())?.contact_rule;
  const eff = rule === "sin_no_efectivo" ? "c.call_class IN ('venta','negativo')" : "c.call_class IN ('venta','negativo','no_efectivo')";

  /* ---------- bases: una fila por tipo de base (original + adicionales juntas) ---------- */
  const datasets = [...new Set(ofMonth.filter((u) => u.kind === "base").map((u) => u.dataset))].sort();
  const bases: PresBase[] = [];
  for (const dataset of datasets) {
    const ids = ofMonth.filter((u) => u.kind === "base" && u.dataset === dataset).map((u) => u.id);
    const prevIds = uploads.filter((u) => u.kind === "base" && u.dataset === dataset && u.month !== month).map((u) => u.id);
    const b = `b AS (SELECT DISTINCT niu FROM base_records WHERE upload_id IN (${ph(ids.length)}))`;
    const c = `c AS (SELECT c.niu, c.category, c.call_class, ROW_NUMBER() OVER (PARTITION BY c.niu ORDER BY c.called_at DESC, c.id DESC) AS rn,
                        COUNT(*) OVER (PARTITION BY c.niu) AS k
                   FROM calls c JOIN b ON b.niu = c.niu WHERE c.upload_id = ?)`;
    const [tot, cont, venta, prev] = await db.batch([
      db
        .prepare(
          `WITH ${b}, ${c}
           SELECT (SELECT COUNT(*) FROM b) AS unicos, COUNT(DISTINCT c.niu) AS recorridos, COUNT(*) AS llamadas,
                  SUM(c.rn = 1 AND c.k = 1) AS un_intento, COUNT(DISTINCT CASE WHEN ${eff} THEN c.niu END) AS contactados FROM c`,
        )
        .bind(...ids, tipif?.id ?? null),
      db
        .prepare(`WITH ${b}, ${c} SELECT COALESCE(NULLIF(TRIM(c.category), ''), 'Sin Tipificar') AS label, COUNT(*) AS n FROM c WHERE c.rn = 1 GROUP BY 1 ORDER BY n DESC`)
        .bind(...ids, tipif?.id ?? null),
      db
        .prepare(`WITH ${b} SELECT COUNT(DISTINCT s.niu) AS clientes, COALESCE(SUM(s.amount), 0) AS monto FROM bank_sales s JOIN b ON b.niu = s.niu WHERE s.upload_id = ? AND s.sale_date LIKE ?`)
        .bind(...ids, sabana?.id ?? null, `${month}%`),
      prevIds.length
        ? db.prepare(`SELECT COUNT(DISTINCT niu) AS n FROM base_records WHERE upload_id IN (${ph(prevIds.length)})`).bind(...prevIds)
        : db.prepare("SELECT NULL AS n"),
    ]);
    const t = tot!.results[0] as Record<string, number>;
    const v = venta!.results[0] as { clientes: number; monto: number };
    const p = (prev!.results[0] as { n: number | null } | undefined)?.n;
    bases.push({
      dataset,
      unicos: n(t.unicos),
      recorridos: n(t.recorridos),
      contactados: n(t.contactados),
      llamadas: n(t.llamadas),
      unIntento: n(t.un_intento),
      conVenta: n(v.clientes),
      montoVenta: n(v.monto),
      contacto: (cont!.results as { label: string; n: number }[]).map((x) => ({ label: x.label, n: n(x.n) })),
      mesAnterior: p === null || p === undefined ? null : n(p),
    });
  }

  /* ---------- sábana: cada venta con su estatus, si cuenta y a qué base pertenece ---------- */
  const ventas: PresVenta[] = [];
  if (sabana) {
    const counted = a.cumplimiento.config.estatus;
    const label = "COALESCE(NULLIF(TRIM(status_raw), ''), '(sin estatus)')";
    const prevLabel = "COALESCE(NULLIF(TRIM(p.status_raw), ''), '(sin estatus)')";
    const inList = counted.length ? `${label} IN (${ph(counted.length)})` : "0";
    const prevCte = counted.length
      ? `prev AS (SELECT DISTINCT p.niu, COALESCE(p.sale_date, '') AS d FROM bank_sales p
           WHERE p.upload_id IN (SELECT id FROM uploads WHERE campaign = ? AND kind = 'sabana' AND is_current = 1 AND month < ?)
             AND ${prevLabel} IN (${ph(counted.length)}))`
      : "prev AS (SELECT NULL AS niu, NULL AS d WHERE 0)";
    const prevBinds = counted.length ? [campaign, month, ...counted] : [];
    const measure = a.cumplimiento.unidad === "monto" ? "COALESCE(amount, 0)" : "1";
    const cuenta = campaign === "tdc" ? `json_extract(extra, '$."PRI - SEG / CUENTA"')` : "NULL";
    const [rows, miembros] = await db.batch([
      db
        .prepare(
          `WITH ${prevCte}
           SELECT niu, sale_date, ${label} AS estatus, COALESCE(process, '') AS proceso, ${measure} AS m, ${cuenta} AS cuenta,
                  CASE WHEN ${inList} THEN (CASE WHEN EXISTS (SELECT 1 FROM prev WHERE prev.niu = bank_sales.niu AND prev.d = COALESCE(bank_sales.sale_date, '')) THEN 2 ELSE 1 END) ELSE 0 END AS k
             FROM bank_sales WHERE upload_id = ?`,
        )
        .bind(...prevBinds, ...counted, sabana.id),
      // A qué base (de qué mes) pertenece cada cliente de la sábana.
      db
        .prepare(
          `SELECT DISTINCT b.niu, b.dataset, u.month FROM base_records b JOIN uploads u ON u.id = b.upload_id
            WHERE u.campaign = ? AND u.kind = 'base' AND u.is_current = 1 AND b.niu IN (SELECT niu FROM bank_sales WHERE upload_id = ?)`,
        )
        .bind(campaign, sabana.id),
    ]);
    const enBase = new Map<string, { dataset: string; month: string }[]>();
    for (const r of miembros!.results as { niu: string; dataset: string; month: string }[]) enBase.set(r.niu, [...(enBase.get(r.niu) ?? []), r]);
    const order = (ds: string) => (/piloto/.test(ds) ? 1 : 0);
    const grupoDe = (niu: string, saleMonth: string, cuentaRaw: unknown): string | null => {
      const byCuenta = cuentaTdc(cuentaRaw);
      if (byCuenta) return byCuenta;
      const list = enBase.get(niu);
      if (!list?.length) return null;
      const same = list.filter((x) => x.month === saleMonth);
      const pick = (same.length ? same : list.filter((x) => x.month === month).length ? list.filter((x) => x.month === month) : list).sort((x, y) => order(x.dataset) - order(y.dataset) || x.dataset.localeCompare(y.dataset));
      return pick[0]!.dataset;
    };
    const groups = new Map<string, PresVenta>();
    for (const r of rows!.results as { niu: string; sale_date: string | null; estatus: string; proceso: string; m: number; cuenta: unknown; k: number }[]) {
      const sm = r.sale_date?.slice(0, 7) ?? month;
      const origen = sm < month ? "cosecha" : "mes";
      const grupo = grupoDe(r.niu, sm, r.cuenta);
      const semana = origen === "mes" ? semanaDe(month, r.sale_date) : null;
      const key = [grupo, origen, r.estatus, r.k, r.proceso, semana].join("|");
      const g = groups.get(key) ?? { grupo, origen, estatus: r.estatus, k: (n(r.k) as 0 | 1 | 2), proceso: r.proceso, semana, ops: 0, nius: [], valor: 0 };
      g.ops++;
      g.valor += n(r.m);
      g.nius.push(r.niu);
      groups.set(key, g);
    }
    ventas.push(...groups.values());
  }

  /* ---------- motivos de no venta: tipología → subtipología (todas las llamadas del mes) ---------- */
  const motivos = tipif
    ? (
        await db
          .prepare(
            `SELECT COALESCE(NULLIF(TRIM(tipologia), ''), 'Sin Tipificar') AS t,
                    COALESCE(NULLIF(TRIM(json_extract(extra, '$.Subtipologia')), ''), NULLIF(TRIM(tipologia), ''), 'Sin Tipificar') AS s, COUNT(*) AS n
               FROM calls WHERE upload_id = ? AND call_class NOT IN ('no_contacto', 'venta') GROUP BY 1, 2`,
          )
          .bind(tipif.id)
          .all<{ t: string; s: string; n: number }>()
      ).results.map((x) => ({ tipologia: x.t, subtipologia: x.s, n: n(x.n) }))
    : [];

  /* ---------- trimestre: meta y ventas de cada mes del trimestre hasta este ---------- */
  const q0 = Math.floor((Number(month.slice(5, 7)) - 1) / 3) * 3 + 1;
  const trimestre: PresMesGap[] = [];
  for (let mo = q0; mo <= Number(month.slice(5, 7)); mo++) {
    const m = `${month.slice(0, 4)}-${String(mo).padStart(2, "0")}`;
    const x = m === month ? a : a.months.includes(m) ? await analyzeCampaign(env, campaign, m) : null;
    if (!x || x.month !== m) continue;
    const c = x.cumplimiento;
    // El mes en curso se mide contra la meta MTD (a los días hábiles que lleva la sábana); los meses cerrados, contra la meta completa.
    const enCurso = m === month;
    const share = c.diasDelMes ? c.diaDelMes / c.diasDelMes : 0;
    trimestre.push({
      month: m,
      meta: enCurso ? c.esperado : c.meta,
      metaPorAgente: enCurso ? (c.metaPorAgente === null ? null : c.metaPorAgente * share) : c.metaPorAgente,
      mtd: enCurso,
      resultado: c.ventas,
      porAgente: c.porAgente.map((p) => ({ agent: p.agent, ventas: p.ventas })),
      agentes: x.agentes,
    });
  }

  return {
    campaign,
    month,
    unidad: a.cumplimiento.unidad,
    meta: a.cumplimiento.meta,
    esperado: a.cumplimiento.esperado,
    diasHabiles: { transcurridos: a.cumplimiento.diaDelMes, total: a.cumplimiento.diasDelMes },
    resultado: a.cumplimiento.ventas,
    fechaCorte: a.cumplimiento.fechaCorte,
    bases,
    ventas,
    motivos,
    trimestre,
  };
}

export function registerPresentacion(r: Router): void {
  r.on("GET", "/presentacion/datos/:campaign", "datos:ver", async ({ env, params, url }) => {
    const campaign = params.campaign!;
    if (!isCampaignCode(campaign)) throw new HttpError(404, "Campaña desconocida.");
    const mes = url.searchParams.get("mes");
    if (mes && !MES.test(mes)) throw new HttpError(400, "Mes inválido.");
    return json({ ok: true, datos: await presentacionDatos(env, campaign, mes) });
  });

  /** La plantilla guardada: de qué mes son sus cifras, cómo se llamaba y quién la dejó. */
  r.on("GET", "/presentacion/plantilla", "datos:ver", async ({ env }) => {
    const obj = await env.FILES.head(PLANTILLA);
    if (!obj) return json({ ok: true, plantilla: null });
    const m = obj.customMetadata ?? {};
    return json({ ok: true, plantilla: { nombre: m.nombre ?? "presentacion.pptx", mes: m.mes || null, origen: m.origen ?? "subida", por: m.por ?? "", fecha: Number(m.fecha ?? 0), bytes: obj.size } });
  });

  r.on("GET", "/presentacion/plantilla/archivo", "datos:ver", async ({ env }) => {
    const obj = await env.FILES.get(PLANTILLA);
    if (!obj) throw new HttpError(404, "Todavía no hay una presentación guardada.");
    return new Response(obj.body, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });

  /** Guarda la plantilla: la que sube el usuario o la que se acaba de generar (así la próxima semana parte de ella). */
  r.on(
    "PUT",
    "/presentacion/plantilla",
    "reportes:generar",
    async ({ env, req, user }) => {
      const mes = req.headers.get("x-mes") ?? "";
      if (mes && !MES.test(mes)) throw new HttpError(400, "Mes inválido.");
      let nombre = req.headers.get("x-nombre") ?? "presentacion.pptx";
      try {
        nombre = decodeURIComponent(nombre);
      } catch {
        /* ya venía sin codificar */
      }
      nombre = nombre.replace(/[\\/\r\n]/g, "_").slice(0, 150) || "presentacion.pptx";
      const origen = req.headers.get("x-origen") === "generada" ? "generada" : "subida";
      if (Number(req.headers.get("content-length") ?? 0) > MAX_PPTX) throw new HttpError(413, "La presentación es demasiado grande (máximo 60 MB).");
      const body = await req.arrayBuffer();
      const head = new Uint8Array(body.slice(0, 4));
      if (body.byteLength < 100 || head[0] !== 0x50 || head[1] !== 0x4b) throw new HttpError(400, "El archivo no es una presentación de PowerPoint (.pptx).");
      const meta = { nombre, mes, origen, por: user.username, fecha: String(Date.now()) };
      const type = { contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" };
      await env.FILES.put(PLANTILLA, body, { httpMetadata: type, customMetadata: meta });
      // Copia de cada versión, por si se necesita volver a una anterior.
      await env.FILES.put(`presentacion/historial/${Date.now()}-${nombre}`, body, { httpMetadata: type, customMetadata: meta });
      await audit(env, user.username, origen === "generada" ? "presentacion_generada" : "presentacion_plantilla", nombre, { mes });
      return json({ ok: true });
    },
    { raw: true },
  );
}
