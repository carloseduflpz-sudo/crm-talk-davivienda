/* Homologación de agentes en las consultas: los nombres que la herramienta unió se reemplazan
   dentro del SQL (CASE ... WHEN 'forma escrita' THEN 'nombre homologado'), así todas las cifras por
   agente, el filtro y el detalle usan un solo nombre por persona sin reescribir los datos guardados. */
import { agentRenames, homologateAgents, type AgentGroup } from "@crm/core";
import type { Env } from "./env";

/** Tabla y columna del agente según el tipo de archivo. */
export const AGENT_COLUMN: Record<string, [table: string, col: string] | undefined> = {
  sabana: ["bank_sales", "executive"],
  tipif: ["calls", "agent"],
  ventas: ["crm_sales", "agent"],
};

/** Literal de texto para SQLite (las comillas se duplican; no hay otras secuencias de escape). */
const lit = (s: string) => `'${s.replace(/\0/g, "").replace(/'/g, "''")}'`;

export interface AgentNaming {
  /** Expresión SQL con el nombre homologado del agente de esa columna (vacío = "Sin asignar"). */
  sql: (col: string) => string;
  groups: AgentGroup[];
}

const plain = (col: string) => `COALESCE(NULLIF(TRIM(${col}), ''), 'Sin asignar')`;

export async function loadAgentNaming(env: Env, campaign: string): Promise<AgentNaming> {
  const { results } = await env.DB.prepare(
    `SELECT raw, SUM(rows) AS rows FROM agent_names
      WHERE campaign = ?1 AND upload_id IN (SELECT id FROM uploads WHERE campaign = ?1 AND status <> 'descartada')
      GROUP BY raw`,
  )
    .bind(campaign)
    .all<{ raw: string; rows: number }>();
  const groups = homologateAgents(results.map((r) => ({ raw: r.raw, rows: Number(r.rows ?? 0) })));
  const renames = [...agentRenames(groups)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (!renames.length) return { sql: plain, groups };
  const whens = renames.map(([raw, name]) => `WHEN ${lit(raw)} THEN ${lit(name)}`).join(" ");
  return { sql: (col) => `(CASE TRIM(${col}) ${whens} ELSE ${plain(col)} END)`, groups };
}

/** Guarda cómo vienen escritos los agentes de una carga (se llama al confirmarla). */
export function recordAgentNames(env: Env, upload: { id: string; campaign: string; kind: string }): D1PreparedStatement | null {
  const tc = AGENT_COLUMN[upload.kind];
  if (!tc) return null;
  const [table, col] = tc;
  return env.DB.prepare(
    `INSERT OR REPLACE INTO agent_names (upload_id, campaign, raw, rows)
       SELECT ?1, ?2, TRIM(${col}), COUNT(*) FROM ${table} WHERE upload_id = ?1 AND TRIM(COALESCE(${col}, '')) <> '' GROUP BY TRIM(${col})`,
  ).bind(upload.id, upload.campaign);
}
