/* Llamadas sin NIU → su cliente, por el teléfono marcado.
   En VICI más de la mitad de las llamadas vienen sin id del cliente: las que el marcador hizo y no
   llegaron a un agente ("Sin asignar a un agente"), las que quedaron sin tipificar y parte del
   "No contacto". Sin NIU no cuentan como cliente recorrido ni entran a la gráfica de contacto.
   El teléfono sí viene siempre, así que se busca de quién es:
   1. otra llamada del mismo archivo, al mismo teléfono, que sí trae el NIU;
   2. si no, las columnas de teléfono o celular de las bases vigentes del mes.
   Corre solo al confirmar unas tipificaciones o una base; nadie tiene que hacer nada. */
import type { Env } from "./env";

/** Quita lo que no es dígito (SQLite no tiene expresiones regulares) y deja los últimos 8. */
const limpio = (v: string) => `replace(replace(replace(replace(replace(replace(replace(replace(${v}, ' ', ''), '-', ''), '(', ''), ')', ''), '+', ''), '.', ''), '/', ''), char(160), '')`;

/** Saca (una sola vez por base) los teléfonos de las columnas de teléfono/celular de la base. */
async function telefonosDeBase(env: Env, uploadId: string): Promise<void> {
  const listo = await env.DB.prepare("SELECT 1 AS x FROM base_phones_listas WHERE upload_id = ?").bind(uploadId).first();
  if (listo) return;
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO base_phones (upload_id, niu, phone)
       SELECT upload_id, niu, substr(d, -8) FROM (
         SELECT b.upload_id, b.niu, ${limpio("CASE j.type WHEN 'real' THEN CAST(CAST(j.value AS INTEGER) AS TEXT) ELSE CAST(j.value AS TEXT) END")} AS d
           FROM base_records b, json_each(b.extra) j
          WHERE b.upload_id = ? AND b.extra IS NOT NULL AND j.type IN ('text', 'integer', 'real')
            AND (lower(j.key) LIKE '%tel%' OR lower(j.key) LIKE '%cel%' OR lower(j.key) LIKE '%movil%' OR lower(j.key) LIKE '%móvil%' OR lower(j.key) LIKE '%phone%'))
        WHERE length(d) BETWEEN 8 AND 12 AND d NOT GLOB '*[^0-9]*'`,
    ).bind(uploadId),
    env.DB.prepare("INSERT OR IGNORE INTO base_phones_listas (upload_id) VALUES (?)").bind(uploadId),
  ]);
}

/** Une a su cliente las llamadas sin NIU de las tipificaciones vigentes de una campaña y mes. Devuelve cuántas unió. */
export async function unirLlamadasPorTelefono(env: Env, campaign: string, month: string): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, kind FROM uploads WHERE campaign = ? AND month = ? AND is_current = 1 AND kind IN ('tipif', 'base')")
    .bind(campaign, month)
    .all<{ id: string; kind: string }>();
  const tipif = results.find((u) => u.kind === "tipif");
  if (!tipif) return 0;
  const bases = results.filter((u) => u.kind === "base").map((u) => u.id);
  for (const id of bases) await telefonosDeBase(env, id);
  const inBases = bases.length ? `SELECT p.niu FROM base_phones p WHERE p.phone = calls.phone AND p.upload_id IN (${bases.map(() => "?").join(", ")}) LIMIT 1` : "SELECT NULL";
  const sinNiu = env.DB.prepare("SELECT COUNT(*) AS n FROM calls WHERE upload_id = ? AND niu = ''").bind(tipif.id);
  const antes = Number((await sinNiu.first<{ n: number }>())?.n ?? 0);
  if (!antes) return 0;
  await env.DB.prepare(
    `UPDATE calls SET niu = COALESCE(
        (SELECT c2.niu FROM calls c2 WHERE c2.upload_id = ? AND c2.phone = calls.phone AND c2.niu <> '' LIMIT 1),
        (${inBases}),
        '')
      WHERE upload_id = ? AND niu = '' AND phone IS NOT NULL`,
  )
    .bind(tipif.id, ...bases, tipif.id)
    .run();
  const despues = Number((await sinNiu.first<{ n: number }>())?.n ?? 0);
  return antes - despues;
}
