/* Base D1 en memoria para pruebas: SQLite real (node:sqlite) con las migraciones del proyecto.
   Implementa la parte de la API de D1 que usa el Worker: prepare/bind/first/all/run y batch. */
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations/", import.meta.url));

type Value = string | number | bigint | null | Uint8Array;
const toSql = (v: unknown): Value => {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v as Value;
};

class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private args: Value[] = [],
  ) {}
  bind(...args: unknown[]) {
    return new Statement(this.db, this.sql, args.map(toSql));
  }
  async first<T>(col?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.args) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (col ? row[col] : { ...row }) as T;
  }
  async all<T>() {
    const rows = this.db.prepare(this.sql).all(...this.args) as T[];
    return { results: rows.map((r) => ({ ...r })), success: true, meta: {} };
  }
  async run() {
    return this.runSync();
  }
  allSync() {
    const rows = this.db.prepare(this.sql).all(...this.args) as Record<string, unknown>[];
    return { success: true, results: rows.map((r) => ({ ...r })), meta: { changes: 0, last_row_id: 0 } };
  }
  get isQuery() {
    return /^\s*(SELECT|WITH)\b/i.test(this.sql);
  }
  runSync() {
    const r = this.db.prepare(this.sql).run(...this.args);
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
}

export function memoryD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const f of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) db.exec(readFileSync(MIGRATIONS + f, "utf8"));
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(stmts: Statement[]) {
      db.exec("BEGIN");
      try {
        const out = stmts.map((s) => (s.isQuery ? s.allSync() : s.runSync()));
        db.exec("COMMIT");
        return out;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
  return d1 as unknown as D1Database;
}
