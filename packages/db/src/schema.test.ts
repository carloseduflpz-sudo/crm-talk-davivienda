/* Garantiza que las migraciones SQL y el esquema de Drizzle digan lo mismo,
   y que los catálogos sembrados coincidan con la configuración de packages/core. */
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { CAMPAIGNS, DEFAULT_TIPOLOGIAS, matchKey } from "@crm/core";
import { getTableConfig, type SQLiteTable } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";

const dir = fileURLToPath(new URL("../migrations/", import.meta.url));

function migratedDb() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(dir + f, "utf8"));
  return db;
}

const tables = Object.values(schema).filter((v): v is SQLiteTable => {
  try {
    getTableConfig(v as SQLiteTable);
    return true;
  } catch {
    return false;
  }
});

describe("migraciones vs esquema", () => {
  const db = migratedDb();

  it("cada tabla del esquema existe con las mismas columnas", () => {
    expect(tables.length).toBeGreaterThanOrEqual(16);
    for (const t of tables) {
      const cfg = getTableConfig(t);
      const cols = db.prepare(`PRAGMA table_info(${cfg.name})`).all() as { name: string; notnull: number }[];
      expect(cols.map((c) => c.name).sort(), cfg.name).toEqual(cfg.columns.map((c) => c.name).sort());
      for (const col of cfg.columns) {
        const sqlCol = cols.find((c) => c.name === col.name);
        expect(Boolean(sqlCol?.notnull) || col.primary, `${cfg.name}.${col.name} NOT NULL`).toBe(col.notNull);
      }
    }
  });

  it("no hay tablas en SQL que falten en el esquema", () => {
    const sqlTables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map(
      (r) => r.name,
    );
    expect(sqlTables.sort()).toEqual(tables.map((t) => getTableConfig(t).name).sort());
  });
});

describe("catálogos sembrados", () => {
  const db = migratedDb();

  it("las 6 campañas", () => {
    const rows = db.prepare("SELECT code FROM campaigns ORDER BY rowid").all() as { code: string }[];
    expect(rows.map((r) => r.code)).toEqual(CAMPAIGNS.map((c) => c.code));
  });

  it("estatus aprobados y rechazados de cada campaña", () => {
    for (const c of CAMPAIGNS) {
      const rows = db.prepare("SELECT status_key, class FROM status_map WHERE campaign = ?").all(c.code) as { status_key: string; class: string }[];
      const expected = [...c.approved.map((s) => [matchKey(s), "aprobado"]), ...c.rejected.map((s) => [matchKey(s), "rechazado"])];
      expect(rows.map((r) => [r.status_key, r.class]).sort()).toEqual(expected.sort());
    }
  });

  it("las 143 tipologías", () => {
    const n = (db.prepare("SELECT COUNT(*) AS n FROM tipologia_map").get() as { n: number }).n;
    expect(n).toBe(DEFAULT_TIPOLOGIAS.length);
  });
});
