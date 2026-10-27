/* Presentación semanal: las cifras que lleva cada lámina, calculadas con los archivos vigentes del mes,
   y la plantilla (.pptx) guardada en R2 para que cada semana baste con darle "Descargar". */
import { isCampaignCode, semanasDelMes, type CampaignCode, type PresBase, type PresentacionCampania, type PresMesGap, type PresVenta } from "@crm/core";
import { analyzeCampaign } from "./analisis";
import { audit } from "./audit";
import type { Env } from "./env";
import { HttpError, json, type Router } from "./http";
import { Resultados } from "./resultados";

const PLANTILLA = "presentacion/plantilla.pptx";
/** Excel de las gráficas: de él salen la M, la R y el contacto de la presentación. */
const CONTROL = "presentacion/control.xlsx";
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

/** Cifras de la presentación; si ya se calcularon con los mismos archivos, salen de lo guardado. */
export function presentacionDatos(env: Env, campaign: CampaignCode, mes: string | null, resultados: Resultados = new Resultados(env)): Promise<PresentacionCampania | null> {
  return resultados.obtener(`presentacion/${campaign}/${mes ?? "ultimo"}.json`, () => calcularPresentacion(env, campaign, mes, resultados));
}

async function calcularPresentacion(env: Env, campaign: CampaignCode, mes: string | null, resultados: Resultados): Promise<PresentacionCampania | null> {
  const a = await analyzeCampaign(env, campaign, mes, null, resultados);
  if (!a.month) return null;
  const month = a.month;
  const db = env.DB;
  // Velocidad: cada consulta es un viaje a la base; lo que no depende entre sí se pide junto.
  const [{ results: uploads }, ruleRow] = await Promise.all([
    db.prepare("SELECT id, dataset, kind, month FROM uploads WHERE campaign = ? AND is_current = 1 AND month IN (?, ?)").bind(campaign, month, prevMonth(month)).all<Upload>(),
    db.prepare("SELECT contact_rule FROM campaigns WHERE code = ?").bind(campaign).first<{ contact_rule: string }>(),
  ]);
  const ofMonth = uploads.filter((u) => u.month === month);
  const sabana = ofMonth.find((u) => u.kind === "sabana");
  const tipif = ofMonth.find((u) => u.kind === "tipif");
  const rule = ruleRow?.contact_rule;
  const eff = rule === "sin_no_efectivo" ? "c.call_class IN ('venta','negativo')" : "c.call_class IN ('venta','negativo','no_efectivo')";

  /* ---------- bases: una fila por tipo de base (original + adicionales juntas) ---------- */
  const datasets = [...new Set(ofMonth.filter((u) => u.kind === "base").map((u) => u.dataset))].sort();
  const basesP = Promise.all(datasets.map(async (dataset): Promise<PresBase> => {
    const ids = ofMonth.filter((u) => u.kind === "base" && u.dataset === dataset).map((u) => u.id);
    const prevIds = uploads.filter((u) => u.kind === "base" && u.dataset === dataset && u.month !== month).map((u) => u.id);
    const b = `b AS (SELECT DISTINCT niu FROM base_records WHERE upload_id IN (${ph(ids.length)}))`;
    const c = `c AS (SELECT c.niu, c.category, c.call_class, ROW_NUMBER() OVER (PARTITION BY c.niu ORDER BY c.called_at DESC, c.id DESC) AS rn,
                        COUNT(*) OVER (PARTITION BY c.niu) AS k
                   FROM calls c WHERE c.upload_id = ? AND c.niu IN (SELECT niu FROM b))`;
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
    return {
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
    };
  }));

  /* ---------- sábana: cada venta con su estatus, si cuenta y a qué base pertenece ---------- */
  const ventas: PresVenta[] = [];
  const documentos: NonNullable<PresentacionCampania["documentos"]> = [];
  const clientesActivos = { total: 0, porSemana: {} as Record<string, number> };
  const sabanaP = (async () => {
    if (sabana) {
      const counted = a.cumplimiento.config.estatus;
      const label = "COALESCE(NULLIF(TRIM(status_raw), ''), '(sin estatus)')";
      const prevLabel = "COALESCE(NULLIF(TRIM(p.status_raw), ''), '(sin estatus)')";
      // La lista de estatus viaja como un solo JSON: D1 acepta máximo 100 valores por consulta.
      const inList = counted.length ? `${label} IN (SELECT value FROM json_each(?))` : "0";
      const prevCte = counted.length
        ? `prev AS (SELECT DISTINCT p.niu, COALESCE(p.sale_date, '') AS d FROM bank_sales p
             WHERE p.upload_id IN (SELECT id FROM uploads WHERE campaign = ? AND kind = 'sabana' AND is_current = 1 AND month < ?)
               AND ${prevLabel} IN (SELECT value FROM json_each(?)))`
        : "prev AS (SELECT NULL AS niu, NULL AS d WHERE 0)";
      const lista = JSON.stringify(counted);
      const prevBinds = counted.length ? [campaign, month, lista] : [];
      const measure = a.cumplimiento.unidad === "monto" ? "COALESCE(amount, 0)" : "1";
      // TDC: la sábana dice si la venta es de primera o segunda cuenta.
      const cuentaCol = `json_extract(extra, '$."PRI - SEG / CUENTA"')`;
      const cuenta =
        campaign === "tdc"
          ? `CASE WHEN lower(${cuentaCol}) LIKE '%seg%' OR ${cuentaCol} GLOB '*2*' THEN 'tdc:base:segundas'
                  WHEN lower(${cuentaCol}) LIKE '%pri%' OR ${cuentaCol} GLOB '*1*' THEN 'tdc:base:primeras' END`
          : "NULL";
      // TDC: documentación pedida al cliente (lámina "Seguimiento de documentos").
      const docCols =
        campaign === "tdc"
          ? `, NULLIF(TRIM(json_extract(extra, '$.DOCUMENTACION')), '') AS doc, NULLIF(TRIM(json_extract(extra, '$."PENDIENTE POR REQUISITO"')), '') AS pend, NULLIF(TRIM(reason), '') AS motivo`
          : ", NULL AS doc, NULL AS pend, NULL AS motivo";
      // Semana del mes de la fecha de venta (solo ventas del mes).
      const semanas = semanasDelMes(month);
      const semanaSql = `CASE WHEN origen = 'mes' AND sale_date LIKE '${month}%' THEN CASE ${semanas.map((w) => `WHEN substr(sale_date, 1, 10) <= '${w.hasta}' THEN ${w.semana}`).join(" ")} END END`;
      /* Todo se agrupa en la base de datos (no fila por fila en el Worker): con sábanas grandes el Worker se quedaba sin tiempo.
         Base de cada venta: la que dice la sábana (TDC) o la base vigente donde está el cliente, primero la del mes de la venta. */
      const cte = `WITH ${prevCte},
        s AS (
          SELECT niu, sale_date, ${label} AS estatus, COALESCE(process, '') AS proceso, ${measure} AS m, ${cuenta} AS cuenta${docCols},
                 CASE WHEN sale_date IS NULL OR substr(sale_date, 1, 7) >= ? THEN 'mes' ELSE 'cosecha' END AS origen,
                 COALESCE(substr(sale_date, 1, 7), ?) AS sm,
                 CASE WHEN ${inList} THEN (CASE WHEN (bank_sales.niu || '|' || COALESCE(bank_sales.sale_date, '')) IN (SELECT niu || '|' || d FROM prev) THEN 2 ELSE 1 END) ELSE 0 END AS k
            FROM bank_sales WHERE upload_id = ?),
        g AS (
          SELECT s.*, ${semanaSql} AS semana,
                 -- La de menor clave: primero la del mes de la venta, luego la del mes, luego no piloto, luego por nombre.
                 COALESCE(cuenta, (SELECT substr(MIN(printf('%d%d%d', u.month <> s.sm, u.month <> ?, u.dataset LIKE '%piloto%') || u.dataset), 4)
                                     FROM base_records b JOIN uploads u ON u.id = b.upload_id
                                    WHERE b.niu = s.niu AND u.campaign = ? AND u.kind = 'base' AND u.is_current = 1)) AS grupo
            FROM s)`;
      // En el orden en que aparecen los "?" en la consulta.
      const binds = [...prevBinds, month, month, ...(counted.length ? [lista] : []), sabana.id, month, campaign];
      const [grupos, clientes, docs] = await db.batch([
        db
          .prepare(`${cte} SELECT grupo, origen, estatus, k, proceso, semana, COUNT(*) AS ops, SUM(m) AS valor, COUNT(DISTINCT niu) AS clientes FROM g GROUP BY 1, 2, 3, 4, 5, 6`)
          .bind(...binds),
        // Clientes distintos con venta que cuenta (DOMI: clientes vs colectores), en total y por semana.
        db
          .prepare(`${cte} SELECT -1 AS semana, COUNT(DISTINCT niu) AS n FROM g WHERE k = 1 UNION ALL SELECT semana, COUNT(DISTINCT niu) FROM g WHERE k = 1 AND semana IS NOT NULL GROUP BY semana`)
          .bind(...binds),
        campaign === "tdc"
          ? db.prepare(`${cte} SELECT estatus, doc, pend, motivo, COUNT(*) AS n FROM g WHERE k <> 2 GROUP BY 1, 2, 3, 4`).bind(...binds)
          : db.prepare("SELECT NULL AS estatus WHERE 0"),
      ]);
      for (const r of grupos!.results as { grupo: string | null; origen: "mes" | "cosecha"; estatus: string; k: number; proceso: string; semana: number | null; ops: number; valor: number; clientes: number }[]) {
        ventas.push({ grupo: r.grupo ?? null, origen: r.origen, estatus: r.estatus, k: n(r.k) as 0 | 1 | 2, proceso: r.proceso, semana: r.semana === null ? null : n(r.semana), ops: n(r.ops), valor: n(r.valor), clientes: n(r.clientes) });
      }
      for (const r of clientes!.results as { semana: number; n: number }[]) {
        if (n(r.semana) === -1) clientesActivos.total = n(r.n);
        else clientesActivos.porSemana[String(n(r.semana))] = n(r.n);
      }
      for (const r of docs!.results as { estatus: string; doc: string | null; pend: string | null; motivo: string | null; n: number }[]) {
        documentos.push({ estatus: r.estatus, doc: r.doc ?? null, pendiente: r.pend ?? null, motivo: r.motivo ?? null, n: n(r.n) });
      }
    }
  })();

  /* ---------- motivos de no venta: tipología → subtipología (todas las llamadas del mes) ---------- */
  const motivosP = tipif
    ? db
        .prepare(
            `SELECT COALESCE(NULLIF(TRIM(tipologia), ''), 'Sin Tipificar') AS t,
                    COALESCE(NULLIF(TRIM(json_extract(extra, '$.Subtipologia')), ''), NULLIF(TRIM(tipologia), ''), 'Sin Tipificar') AS s, COUNT(*) AS n
               FROM calls WHERE upload_id = ? AND call_class NOT IN ('no_contacto', 'venta') GROUP BY 1, 2`,
          )
          .bind(tipif.id)
          .all<{ t: string; s: string; n: number }>()
          .then((r) => r.results.map((x) => ({ tipologia: x.t, subtipologia: x.s, n: n(x.n) })))
    : Promise.resolve([]);

  /* ---------- trimestre: meta y ventas de cada mes del trimestre hasta este ---------- */
  const q0 = Math.floor((Number(month.slice(5, 7)) - 1) / 3) * 3 + 1;
  const delTrimestre: string[] = [];
  for (let mo = q0; mo <= Number(month.slice(5, 7)); mo++) delTrimestre.push(`${month.slice(0, 4)}-${String(mo).padStart(2, "0")}`);
  const trimestreP = Promise.all(delTrimestre.map((m) => (m === month ? a : a.months.includes(m) ? analyzeCampaign(env, campaign, m, null, resultados) : null)));

  const [bases, , motivos, analisisTrimestre] = await Promise.all([basesP, sabanaP, motivosP, trimestreP]);
  const trimestre: PresMesGap[] = [];
  for (const [i, m] of delTrimestre.entries()) {
    const x = analisisTrimestre[i];
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
    hc: a.cumplimiento.agentes,
    esperado: a.cumplimiento.esperado,
    diasHabiles: { transcurridos: a.cumplimiento.diaDelMes, total: a.cumplimiento.diasDelMes },
    resultado: a.cumplimiento.ventas,
    fechaCorte: a.cumplimiento.fechaCorte,
    fechasPosteriores: a.cumplimiento.fechasPosteriores,
    bases,
    ventas,
    clientesActivos,
    ...(campaign === "tdc" ? { documentos } : {}),
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

  /** El Excel de las gráficas guardado (o null). */
  r.on("GET", "/presentacion/control", "datos:ver", async ({ env }) => {
    const obj = await env.FILES.head(CONTROL);
    if (!obj) return json({ ok: true, control: null });
    const m = obj.customMetadata ?? {};
    return json({ ok: true, control: { nombre: m.nombre ?? "control.xlsx", por: m.por ?? "", fecha: Number(m.fecha ?? 0), bytes: obj.size } });
  });

  r.on("GET", "/presentacion/control/archivo", "datos:ver", async ({ env }) => {
    const obj = await env.FILES.get(CONTROL);
    if (!obj) throw new HttpError(404, "No hay un Excel de las gráficas guardado.");
    return new Response(obj.body, { headers: { "content-type": "application/octet-stream", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  });

  r.on(
    "PUT",
    "/presentacion/control",
    "reportes:generar",
    async ({ env, req, user }) => {
      let nombre = req.headers.get("x-nombre") ?? "control.xlsx";
      try {
        nombre = decodeURIComponent(nombre);
      } catch {
        /* ya venía sin codificar */
      }
      nombre = nombre.replace(/[\\/\r\n]/g, "_").slice(0, 150) || "control.xlsx";
      if (Number(req.headers.get("content-length") ?? 0) > MAX_PPTX) throw new HttpError(413, "El Excel es demasiado grande (máximo 60 MB).");
      const body = await req.arrayBuffer();
      const h = new Uint8Array(body.slice(0, 4));
      // .xlsx/.xlsm/.xlsb son ZIP (PK); el .xls viejo es un documento OLE (D0 CF 11 E0).
      const zip = h[0] === 0x50 && h[1] === 0x4b;
      const ole = h[0] === 0xd0 && h[1] === 0xcf && h[2] === 0x11 && h[3] === 0xe0;
      if (body.byteLength < 100 || (!zip && !ole)) throw new HttpError(400, "El archivo no es un Excel.");
      const meta = { nombre, por: user.username, fecha: String(Date.now()) };
      await env.FILES.put(CONTROL, body, { httpMetadata: { contentType: "application/octet-stream" }, customMetadata: meta });
      await audit(env, user.username, "presentacion_excel", nombre);
      return json({ ok: true });
    },
    { raw: true },
  );

  r.on("POST", "/presentacion/control/quitar", "reportes:generar", async ({ env, user }) => {
    await env.FILES.delete(CONTROL);
    await audit(env, user.username, "presentacion_excel_quitado", CONTROL);
    return json({ ok: true });
  });
}
