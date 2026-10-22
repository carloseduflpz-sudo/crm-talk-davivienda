/* Genera packages/db/migrations/0002_catalogos.sql a partir de packages/core.
   Uso: npx tsx scripts/generar-catalogos.ts
   La migración ya generada se guarda en el repositorio; este script solo se usa
   para recrearla. Cambios posteriores a los catálogos se hacen desde la app. */
import { writeFileSync } from "node:fs";
import { CAMPAIGNS, DEFAULT_TIPOLOGIAS, matchKey } from "../packages/core/src/index";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const lines: string[] = [
  "-- Catálogos iniciales: campañas, estatus del banco y tipologías de VICI.",
  "-- Generado por scripts/generar-catalogos.ts desde packages/core. No editar a mano.",
  "",
];

lines.push("INSERT INTO campaigns (code, name, short_name, status_field) VALUES");
lines.push(CAMPAIGNS.map((c) => `  (${q(c.code)}, ${q(c.name)}, ${q(c.shortName)}, ${q(c.statusField)})`).join(",\n") + ";", "");

const statuses = CAMPAIGNS.flatMap((c) => [
  ...c.approved.map((s) => [c.code, s, "aprobado"] as const),
  ...c.rejected.map((s) => [c.code, s, "rechazado"] as const),
]);
lines.push("INSERT INTO status_map (campaign, status_key, status, class) VALUES");
lines.push(statuses.map(([c, s, k]) => `  (${q(c)}, ${q(matchKey(s))}, ${q(s)}, ${q(k)})`).join(",\n") + ";", "");

lines.push("INSERT INTO tipologia_map (campaign, tipologia_key, tipologia, class) VALUES");
lines.push(DEFAULT_TIPOLOGIAS.map(([c, t, k]) => `  (${q(c)}, ${q(matchKey(t))}, ${q(t)}, ${q(k)})`).join(",\n") + ";", "");

writeFileSync(new URL("../packages/db/migrations/0002_catalogos.sql", import.meta.url), lines.join("\n"));
console.log(`campañas ${CAMPAIGNS.length} · estatus ${statuses.length} · tipologías ${DEFAULT_TIPOLOGIAS.length}`);
