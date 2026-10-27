/* Conversión por segmento: clientes, contactados y con venta por cada valor de las columnas de la base principal
   del mes (y del remanente del mes anterior). Los rangos, las etiquetas y qué segmentos van en la gráfica los
   decide el núcleo (packages/core/src/segmentos.ts). */
import { columnasBase, esColumnaDeSegmento, type PresSegmentoFila } from "@crm/core";
import type { Env } from "./env";

const ph = (k: number) => Array.from({ length: k }, () => "?").join(", ");
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
/** Números redondeados (montos a centenas, tasas a un decimal): así una columna de montos no da miles de grupos.
    Los números escritos como texto ("0.13", "72") se leen como números; "-" y vacío no son un valor. */
const r = (e: string) =>
  `(CASE WHEN abs(${e}) >= 1000 THEN round(${e} / 100.0) * 100 WHEN abs(${e}) >= 100 THEN round(${e} / 10.0) * 10 WHEN abs(${e}) >= 1 THEN round(${e}, 1) ELSE round(${e}, 3) END)`;
const redondeo = (e: string) => `(CASE WHEN typeof(${e}) IN ('integer', 'real') THEN ${r(e)}
  WHEN typeof(${e}) = 'text' AND TRIM(${e}) GLOB '*[0-9]*' AND TRIM(${e}) NOT GLOB '*[^0-9.]*' AND TRIM(${e}) NOT GLOB '*.*.*' THEN ${r(`CAST(TRIM(${e}) AS REAL)`)}
  ELSE NULLIF(NULLIF(TRIM(${e}), ''), '-') END)`;
const MAX_COLUMNAS = 30;
const MAX_VALORES = 400;

export async function segmentosDeBase(
  env: Env,
  datasets: string[],
  idsDe: (dataset: string) => string[],
  prevIdsDe: (dataset: string) => string[],
  tipifId: string | null,
  sabanaId: string | null,
  month: string,
  eff: string,
): Promise<PresSegmentoFila[]> {
  const db = env.DB;
  const ids = datasets.flatMap(idsDe);
  const prevIds = datasets.flatMap(prevIdsDe);
  if (!ids.length) return [];

  // Qué columnas trae la base (una muestra basta: todas las filas de un archivo traen las mismas).
  const { results: keys } = await db
    .prepare(`SELECT DISTINCT j.key AS k FROM (SELECT extra FROM base_records WHERE upload_id IN (${ph(ids.length)}) AND extra IS NOT NULL LIMIT 400) s, json_each(s.extra) j`)
    .bind(...ids)
    .all<{ k: string }>();
  const columnas = keys
    .map((r) => r.k)
    .filter((k) => typeof k === "string" && !k.includes('"') && esColumnaDeSegmento(k))
    .slice(0, MAX_COLUMNAS);

  /* Perfil y oferta se guardan aparte: se agregan a las columnas con el nombre que tienen en cada base.
     Una sola consulta sin UNION: D1 no acepta consultas con muchas partes ("too many terms in compound SELECT"). */
  const nombreDe = (campo: "profile" | "offer") => {
    const casos = datasets.map((ds) => [ds, columnasBase(ds)[campo]] as const).filter((x): x is readonly [string, string] => Boolean(x[1]));
    return { casos, sql: `'$."' || CASE x.dataset ${casos.map(([ds, col]) => `WHEN ${lit(ds)} THEN ${lit(col)}`).join(" ")} ELSE '__${campo}' END || '"'` };
  };
  const perfil = nombreDe("profile");
  const oferta = nombreDe("offer");
  const todas = [...new Set([...perfil.casos.map((c) => c[1]), ...oferta.casos.map((c) => c[1]), ...columnas])];
  if (!todas.length) return [];
  const lista = JSON.stringify(todas.map((k) => [k, `$."${k}"`]));
  const actuales = ids.map(lit).join(", ");
  const todos = [...ids, ...prevIds].map(lit).join(", ");

  // Remanente: clientes del mes anterior que no vienen en la base de este mes (rem = 1).
  const sql = `WITH pr AS (SELECT niu, COALESCE(MIN(CASE WHEN upload_id IN (${actuales}) THEN id END), MIN(id)) AS r,
                          MIN(CASE WHEN upload_id IN (${actuales}) THEN 0 ELSE 1 END) AS rem
                     FROM base_records WHERE upload_id IN (${todos}) GROUP BY niu),
      ct AS (SELECT DISTINCT c.niu FROM calls c WHERE c.upload_id = ? AND ${eff}),
      sv AS (SELECT DISTINCT niu FROM bank_sales WHERE upload_id = ? AND sale_date LIKE ?),
      p AS MATERIALIZED (SELECT pr.rem, json_set(COALESCE(x.extra, '{}'), ${perfil.sql}, x.profile, ${oferta.sql}, x.offer) AS extra,
                                pr.niu IN (SELECT niu FROM ct) AS c, pr.niu IN (SELECT niu FROM sv) AS v
                           FROM pr JOIN base_records x ON x.id = pr.r),
      cols AS (SELECT json_extract(value, '$[0]') AS k, json_extract(value, '$[1]') AS path FROM json_each(?)),
      e AS (SELECT cols.k AS k, json_extract(p.extra, cols.path) AS raw, p.rem AS rem, p.c AS c, p.v AS v FROM p, cols)
    SELECT k, ${redondeo("raw")} AS val, rem, COUNT(*) AS n, SUM(c) AS c, SUM(v) AS v FROM e GROUP BY 1, 2, 3`;
  const { results } = await db
    .prepare(sql)
    .bind(tipifId, sabanaId, `${month}%`, lista)
    .all<{ k: string | null; val: string | number | null; rem: number; n: number; c: number; v: number }>();

  // Columnas con demasiados valores distintos (nombres, códigos…) no sirven de segmento.
  const porColumna = new Map<string, number>();
  for (const r of results) if (r.k && r.val !== null) porColumna.set(r.k, (porColumna.get(r.k) ?? 0) + 1);
  return results
    .filter((r) => r.k && r.val !== null && (porColumna.get(r.k) ?? 0) <= MAX_VALORES)
    .map((r) => ({ columna: r.k!, valor: r.val!, rem: (r.rem ? 1 : 0) as 0 | 1, clientes: Number(r.n ?? 0), contactados: Number(r.c ?? 0), ventas: Number(r.v ?? 0) }));
}
