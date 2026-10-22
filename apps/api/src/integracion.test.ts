/* De punta a punta, igual que en el navegador: Excel → lector → lotes → API → base.
   Para los 27 tipos de archivo, con datos INVENTADOS. */
import { ALL_DATASETS, getCampaign, normalizeRow, parseWorkbook, type CampaignCode, type UploadKind } from "@crm/core";
import { beforeEach, describe, expect, it } from "vitest";
import { workbookFor } from "../../../packages/core/test/libros";
import { memoryD1 } from "../test/d1";
import { createApp } from "./app";
import { SESSION_COOKIE } from "./auth";
import type { Env } from "./env";

const app = createApp();
let env: Env;
let cookie = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await app.handle(
    new Request("https://crm.test/api" + path, {
      method,
      headers: { cookie: `${SESSION_COOKIE}=${cookie}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
    () => {},
  );
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1] ?? "";
  return { status: res.status, data: (await res.json()) as Record<string, unknown> };
}

const TABLE: Record<UploadKind, string> = { base: "base_records", sabana: "bank_sales", tipif: "calls", ventas: "crm_sales" };

beforeEach(async () => {
  env = {
    ASSETS: {} as Fetcher,
    DB: memoryD1(),
    FILES: { head: async () => null } as unknown as R2Bucket,
    APP_ENV: "production",
    SETUP_TOKEN: "clave-de-configuracion-123",
  };
  cookie = "";
  await call("POST", "/auth/configurar", { token: env.SETUP_TOKEN, username: "carlos", displayName: "Carlos", password: "Davivienda2026" });
});

describe("Excel → base de datos, los 27 tipos de archivo", () => {
  for (const ds of ALL_DATASETS) {
    it(ds.id, async () => {
      const campaign = ds.campaign as CampaignCode;
      const kind = ds.kind as UploadKind;
      const parsed = parseWorkbook(workbookFor(ds.id), ds.id);
      if ("error" in parsed) throw new Error(parsed.error);
      const rows = parsed.rows.map((r) => normalizeRow(ds.id, kind, campaign, r));

      const c = await call("POST", "/cargas", {
        campaign,
        dataset: ds.id,
        month: "2026-09",
        fileName: `${getCampaign(campaign).shortName} prueba.xlsx`,
        fileSha256: "b".repeat(64),
        rowsTotal: rows.length + parsed.dropped,
        rowsValid: rows.length,
        rowsDiscarded: parsed.dropped,
      });
      expect(c.status, String(c.data.error)).toBe(201);
      // Lotes de 2 para ejercitar la secuencia.
      for (let i = 0, seq = 0; i < rows.length; i += 2, seq++) {
        const r = await call("POST", `/cargas/${c.data.id}/filas`, { seq, rows: rows.slice(i, i + 2) });
        expect(r.status, String(r.data.error)).toBe(200);
      }
      const ok = await call("POST", `/cargas/${c.data.id}/confirmar`, {});
      expect(ok.status, String(ok.data.error)).toBe(200);

      const n = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${TABLE[kind]} WHERE upload_id = ?`).bind(c.data.id).first<{ n: number }>();
      expect(n?.n).toBe(rows.length);
      if (kind === "sabana") {
        const cls = await env.DB.prepare("SELECT DISTINCT status_class AS c FROM bank_sales").all<{ c: string }>();
        expect(cls.results.length).toBeGreaterThan(0);
      }
    });
  }
});
