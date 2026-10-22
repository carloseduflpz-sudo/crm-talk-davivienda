/* Detalle de clientes detrás de cada cifra del análisis: al hacer clic en un estatus, un motivo,
   una tipificación, un día o un perfil, se listan los registros que lo forman.
   Solo filtros de una lista cerrada (nunca SQL armado con texto del usuario) y siempre sobre
   los archivos VIGENTES del mes. */
import { isCampaignCode } from "@crm/core";
import { agentLabel } from "./analisis";
import { HttpError, json, type Router } from "./http";

interface Source {
  kind: string;
  table: string;
  agent: string | null;
  date: string | null;
  columns: [string, string][];
  order: string;
}

export const DETAIL_SOURCES: Record<string, Source> = {
  ventas: {
    kind: "sabana",
    table: "bank_sales",
    agent: "executive",
    date: "sale_date",
    columns: [
      ["niu", "NIU"],
      ["sale_date", "Fecha de venta"],
      ["executive", "Ejecutivo"],
      ["status_raw", "Estatus del banco"],
      ["reason", "Motivo"],
      ["amount", "Monto"],
      ["process", "Proceso"],
    ],
    order: "sale_date, niu",
  },
  llamadas: {
    kind: "tipif",
    table: "calls",
    agent: "agent",
    date: "called_at",
    columns: [
      ["niu", "NIU"],
      ["called_at", "Fecha y hora"],
      ["agent", "Agente"],
      ["category", "Categoría"],
      ["tipologia", "Tipificación"],
    ],
    order: "called_at, niu",
  },
  crm: {
    kind: "ventas",
    table: "crm_sales",
    agent: "agent",
    date: "entered_at",
    columns: [
      ["niu", "NIU"],
      ["entered_at", "Ingreso"],
      ["agent", "Agente"],
      ["product", "Producto"],
    ],
    order: "entered_at, niu",
  },
  base: {
    kind: "base",
    table: "base_records",
    agent: null,
    date: null,
    columns: [
      ["niu", "NIU"],
      ["profile", "Perfil"],
      ["offer", "Oferta"],
      ["dataset", "Archivo"],
    ],
    order: "niu",
  },
};

const DAY = /^20\d{2}-\d{2}-\d{2}$/;
const MAX_LIMIT = 20_000;

export function registerDetalle(r: Router): void {
  r.on("GET", "/analisis/:campaign/detalle", "datos:ver", async ({ env, params, url }) => {
    const campaign = params.campaign!;
    if (!isCampaignCode(campaign)) throw new HttpError(404, "Campaña desconocida.");
    const q = url.searchParams;
    const src = DETAIL_SOURCES[q.get("fuente") ?? ""];
    if (!src) throw new HttpError(400, "Fuente de detalle desconocida.");
    const mes = q.get("mes") ?? "";
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(mes)) throw new HttpError(400, "Mes inválido.");
    const text = (k: string) => {
      const v = q.get(k)?.trim();
      if (!v) return null;
      if (v.length > 200) throw new HttpError(400, `Filtro demasiado largo: ${k}.`);
      return v;
    };
    const limit = Math.min(Math.max(Number(q.get("limite") ?? 200) || 200, 1), MAX_LIMIT);

    const { results: ups } = await env.DB.prepare("SELECT id FROM uploads WHERE campaign = ? AND month = ? AND kind = ? AND is_current = 1")
      .bind(campaign, mes, src.kind)
      .all<{ id: string }>();
    const columns = src.columns.map(([key, label]) => ({ key, label }));
    if (!ups.length) return json({ ok: true, total: 0, rows: [], columns });

    const where = [`upload_id IN (${ups.map(() => "?").join(", ")})`];
    const binds: unknown[] = ups.map((u) => u.id);
    const add = (sql: string, ...v: unknown[]) => {
      where.push(sql);
      binds.push(...v);
    };

    const agente = text("agente");
    if (agente && src.agent) add(`${agentLabel(src.agent)} = ?`, agente);

    const dia = text("dia");
    const desde = text("desde");
    const hasta = text("hasta");
    if ((dia && !DAY.test(dia)) || (desde && !DAY.test(desde)) || (hasta && !DAY.test(hasta))) throw new HttpError(400, "Fecha inválida.");
    if (src.date && dia) add(`substr(${src.date}, 1, 10) = ?`, dia);
    if (src.date && desde) add(`substr(${src.date}, 1, 10) >= ?`, desde);
    if (src.date && hasta) add(`substr(${src.date}, 1, 10) <= ?`, hasta);

    const clase = text("clase");
    if (src.table === "bank_sales") {
      if (clase) add("status_class = ?", clase);
      // Uno o varios estatus (la meta puede contar varios).
      const estatus = q.getAll("estatus").map((x) => x.trim()).filter(Boolean);
      if (estatus.length > 50 || estatus.some((x) => x.length > 200)) throw new HttpError(400, "Demasiados estatus en el filtro.");
      if (estatus.length) add(`COALESCE(NULLIF(TRIM(status_raw), ''), '(sin estatus)') IN (${estatus.map(() => "?").join(", ")})`, ...estatus);
      const motivo = text("motivo");
      if (motivo) add("status_class = 'rechazado' AND COALESCE(NULLIF(TRIM(reason), ''), 'Sin motivo especificado') = ?", motivo);
      const proceso = text("proceso");
      if (proceso) add("process = ?", proceso);
    }
    if (src.table === "calls") {
      if (clase) add("call_class = ?", clase);
      const tip = text("tipologia");
      if (tip) add("COALESCE(NULLIF(TRIM(tipologia), ''), 'Sin Tipificar') = ?", tip);
    }
    if (src.table === "base_records") {
      // Una carga de base en particular (la original o una adicional).
      const carga = text("carga");
      if (carga) add("upload_id = ?", carga);
      const perfil = text("perfil");
      if (perfil) add("COALESCE(NULLIF(TRIM(profile), ''), 'N/D') = ?", perfil);
    }

    // Búsqueda libre: NIU o nombre del agente.
    const buscar = text("buscar");
    if (buscar) {
      const like = `%${buscar.replace(/[%_\\]/g, (c) => "\\" + c)}%`;
      if (src.agent) add(`(niu LIKE ? ESCAPE '\\' OR ${src.agent} LIKE ? ESCAPE '\\')`, like, like);
      else add("niu LIKE ? ESCAPE '\\'", like);
    }

    const w = where.join(" AND ");
    const [count, rows] = await env.DB.batch([
      env.DB.prepare(`SELECT COUNT(*) AS n FROM ${src.table} WHERE ${w}`).bind(...binds),
      env.DB.prepare(`SELECT ${src.columns.map(([k]) => k).join(", ")} FROM ${src.table} WHERE ${w} ORDER BY ${src.order} LIMIT ?`).bind(...binds, limit),
    ]);
    return json({ ok: true, total: Number((count!.results[0] as { n: number } | undefined)?.n ?? 0), rows: rows!.results, columns });
  });
}
