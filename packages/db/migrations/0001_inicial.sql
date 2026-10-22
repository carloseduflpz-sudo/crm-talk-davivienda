-- CRM Talk Davivienda 2.0 · esquema inicial.
-- Debe coincidir con packages/db/src/schema.ts (la prueba schema.test.ts lo verifica).
-- Se aplica con: npx wrangler d1 migrations apply crm-talk --remote

-- ---------- Catálogos ----------

CREATE TABLE campaigns (
  code          TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  short_name    TEXT NOT NULL,
  status_field  TEXT NOT NULL,
  contact_rule  TEXT NOT NULL DEFAULT 'con_no_efectivo',
  active        INTEGER NOT NULL DEFAULT 1,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE users (
  email         TEXT PRIMARY KEY NOT NULL,
  name          TEXT,
  role          TEXT NOT NULL DEFAULT 'admin',
  active        INTEGER NOT NULL DEFAULT 1,
  last_seen_at  INTEGER,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE periods (
  campaign   TEXT NOT NULL REFERENCES campaigns(code),
  month      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'abierto',
  closed_at  INTEGER,
  closed_by  TEXT,
  PRIMARY KEY (campaign, month)
);

CREATE TABLE goals (
  campaign    TEXT NOT NULL REFERENCES campaigns(code),
  month       TEXT NOT NULL,
  sales_goal  INTEGER NOT NULL,
  agents      INTEGER,
  notes       TEXT,
  updated_by  TEXT NOT NULL,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (campaign, month)
);

CREATE TABLE agents (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE agent_aliases (
  alias_key  TEXT PRIMARY KEY NOT NULL,
  alias      TEXT NOT NULL,
  agent_id   INTEGER NOT NULL REFERENCES agents(id)
);

CREATE TABLE status_map (
  campaign    TEXT NOT NULL REFERENCES campaigns(code),
  status_key  TEXT NOT NULL,
  status      TEXT NOT NULL,
  class       TEXT NOT NULL,
  PRIMARY KEY (campaign, status_key)
);

CREATE TABLE tipologia_map (
  campaign       TEXT NOT NULL REFERENCES campaigns(code),
  tipologia_key  TEXT NOT NULL,
  tipologia      TEXT NOT NULL,
  class          TEXT NOT NULL,
  PRIMARY KEY (campaign, tipologia_key)
);

-- ---------- Cargas y datos ----------

CREATE TABLE uploads (
  id              TEXT PRIMARY KEY NOT NULL,
  campaign        TEXT NOT NULL REFERENCES campaigns(code),
  dataset         TEXT NOT NULL,
  kind            TEXT NOT NULL,
  month           TEXT NOT NULL,
  version         INTEGER NOT NULL,
  is_current      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'validando',
  file_name       TEXT NOT NULL,
  file_key        TEXT,
  file_sha256     TEXT NOT NULL,
  rows_total      INTEGER NOT NULL DEFAULT 0,
  rows_valid      INTEGER NOT NULL DEFAULT 0,
  rows_discarded  INTEGER NOT NULL DEFAULT 0,
  created_by      TEXT NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE UNIQUE INDEX uploads_version_uq ON uploads (dataset, month, version);
CREATE INDEX uploads_current_idx ON uploads (campaign, dataset, month, is_current);

CREATE TABLE base_records (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id  TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  campaign   TEXT NOT NULL,
  dataset    TEXT NOT NULL,
  month      TEXT NOT NULL,
  niu        TEXT NOT NULL,
  profile    TEXT,
  offer      TEXT,
  extra      TEXT
);
CREATE INDEX base_campaign_month_idx ON base_records (campaign, month);
CREATE INDEX base_niu_idx ON base_records (niu);
CREATE INDEX base_upload_idx ON base_records (upload_id);

CREATE TABLE bank_sales (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id        TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  campaign         TEXT NOT NULL,
  month            TEXT NOT NULL,
  niu              TEXT NOT NULL,
  process          TEXT,
  sale_date        TEXT,
  executive        TEXT,
  agent_id         INTEGER REFERENCES agents(id),
  status_raw       TEXT,
  status_class     TEXT NOT NULL,
  reason           TEXT,
  days_in_process  INTEGER,
  amount           REAL,
  extra            TEXT
);
CREATE INDEX sales_campaign_month_idx ON bank_sales (campaign, month);
CREATE INDEX sales_niu_idx ON bank_sales (niu);
CREATE INDEX sales_agent_idx ON bank_sales (campaign, month, agent_id);
CREATE INDEX sales_upload_idx ON bank_sales (upload_id);

CREATE TABLE calls (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id   TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  campaign    TEXT NOT NULL,
  month       TEXT NOT NULL,
  niu         TEXT NOT NULL,
  agent       TEXT,
  agent_id    INTEGER REFERENCES agents(id),
  called_at   TEXT,
  category    TEXT,
  tipologia   TEXT,
  call_class  TEXT NOT NULL,
  extra       TEXT
);
CREATE INDEX calls_campaign_month_idx ON calls (campaign, month);
CREATE INDEX calls_niu_idx ON calls (niu);
CREATE INDEX calls_agent_idx ON calls (campaign, month, agent_id);
CREATE INDEX calls_upload_idx ON calls (upload_id);

CREATE TABLE crm_sales (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  upload_id   TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  campaign    TEXT NOT NULL,
  month       TEXT NOT NULL,
  niu         TEXT NOT NULL,
  agent       TEXT,
  agent_id    INTEGER REFERENCES agents(id),
  entered_at  TEXT,
  product     TEXT,
  extra       TEXT
);
CREATE INDEX crm_campaign_month_idx ON crm_sales (campaign, month);
CREATE INDEX crm_niu_idx ON crm_sales (niu);
CREATE INDEX crm_upload_idx ON crm_sales (upload_id);

-- ---------- Cierres, reportes y bitácora ----------

CREATE TABLE closings (
  campaign     TEXT NOT NULL REFERENCES campaigns(code),
  month        TEXT NOT NULL,
  metric       TEXT NOT NULL,
  value        REAL NOT NULL,
  source       TEXT NOT NULL,
  recorded_by  TEXT NOT NULL,
  recorded_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (campaign, month, metric)
);

CREATE TABLE report_runs (
  id          TEXT PRIMARY KEY NOT NULL,
  week_start  TEXT NOT NULL,
  campaigns   TEXT NOT NULL,
  file_key    TEXT,
  status      TEXT NOT NULL DEFAULT 'generando',
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  user_email  TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT
);
CREATE INDEX audit_ts_idx ON audit_log (ts);
