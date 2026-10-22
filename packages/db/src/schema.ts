/* Esquema de la base D1 "crm-talk".
   Convenciones:
   - Meses como texto "AAAA-MM"; fechas como texto ISO "AAAA-MM-DD" o "AAAA-MM-DDTHH:MM:SS".
   - Toda fila de datos apunta a la carga (upload) de la que salió: cada cifra se puede rastrear.
   - Los campos del Excel que no se usan en cálculos se guardan completos en "extra" (JSON).
   Para cambiar el esquema: editar este archivo y correr `npm run db:generate`. */
import { sql } from "drizzle-orm";
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch() * 1000)`;

/* ---------- Catálogos ---------- */

export const campaigns = sqliteTable("campaigns", {
  code: text("code").primaryKey(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  statusField: text("status_field").notNull(),
  /** Regla de contacto efectivo: "con_no_efectivo" | "sin_no_efectivo" (pendiente de confirmar). */
  contactRule: text("contact_rule").notNull().default("con_no_efectivo"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at").notNull().default(now),
});

/** Usuarios con usuario y contraseña. Los da de alta un administrador desde la app. */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Siempre en minúsculas: letras, números, punto, guion y guion bajo. */
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  /** "admin" | "editor" | "lector" */
  role: text("role").notNull().default("admin"),
  /** "pbkdf2$<iteraciones>$<sal>$<hash>"; nunca la contraseña en texto. */
  passwordHash: text("password_hash").notNull(),
  /** La contraseña la asignó un administrador: se pide cambiarla al entrar. */
  mustChangePassword: integer("must_change_password", { mode: "boolean" }).notNull().default(true),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: integer("locked_until"),
  lastLoginAt: integer("last_login_at"),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

/** Sesiones abiertas. Se guarda la huella SHA-256 del token, nunca el token. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull(),
    userAgent: text("user_agent"),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expires_idx").on(t.expiresAt)],
);

export const periods = sqliteTable(
  "periods",
  {
    campaign: text("campaign").notNull().references(() => campaigns.code),
    month: text("month").notNull(),
    /** "abierto" | "cerrado" */
    status: text("status").notNull().default("abierto"),
    closedAt: integer("closed_at"),
    closedBy: text("closed_by"),
  },
  (t) => [primaryKey({ columns: [t.campaign, t.month] })],
);

export const goals = sqliteTable(
  "goals",
  {
    campaign: text("campaign").notNull().references(() => campaigns.code),
    month: text("month").notNull(),
    salesGoal: integer("sales_goal").notNull(),
    agents: integer("agents"),
    notes: text("notes"),
    /** JSON: estatus de la sábana que cuentan para la meta (null = regla por defecto de la campaña). */
    countedStatuses: text("counted_statuses"),
    /** Días de la semana que se trabajan: "1,2,3,4,5" (0 = domingo). */
    workDays: text("work_days").notNull().default("1,2,3,4,5"),
    /** JSON: fechas no laborables del mes. */
    holidays: text("holidays").notNull().default("[]"),
    updatedBy: text("updated_by").notNull(),
    updatedAt: integer("updated_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.campaign, t.month] })],
);

export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull().default(now),
});

/** Cómo aparece cada agente en cada archivo (VICI, sábana, CRM) → su nombre oficial. */
export const agentAliases = sqliteTable("agent_aliases", {
  aliasKey: text("alias_key").primaryKey(),
  alias: text("alias").notNull(),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agents.id),
});

/** Cómo vienen escritos los agentes en cada carga; la herramienta los homologa sola al analizar. */
export const agentNames = sqliteTable(
  "agent_names",
  {
    uploadId: text("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    campaign: text("campaign").notNull(),
    raw: text("raw").notNull(),
    rows: integer("rows").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.uploadId, t.raw] }), index("agent_names_campaign_idx").on(t.campaign)],
);

/** Estatus de la sábana del banco → aprobado | rechazado | en_proceso. */
export const statusMap = sqliteTable(
  "status_map",
  {
    campaign: text("campaign").notNull().references(() => campaigns.code),
    statusKey: text("status_key").notNull(),
    status: text("status").notNull(),
    class: text("class").notNull(),
  },
  (t) => [primaryKey({ columns: [t.campaign, t.statusKey] })],
);

/** Tipología de VICI → venta | negativo | no_efectivo | no_contacto | sin_tipificar. */
export const tipologiaMap = sqliteTable(
  "tipologia_map",
  {
    campaign: text("campaign").notNull().references(() => campaigns.code),
    tipologiaKey: text("tipologia_key").notNull(),
    tipologia: text("tipologia").notNull(),
    class: text("class").notNull(),
  },
  (t) => [primaryKey({ columns: [t.campaign, t.tipologiaKey] })],
);

/* ---------- Cargas y datos ---------- */

export const uploads = sqliteTable(
  "uploads",
  {
    id: text("id").primaryKey(),
    campaign: text("campaign").notNull().references(() => campaigns.code),
    /** p. ej. "tdc:base:primeras" */
    dataset: text("dataset").notNull(),
    /** "sabana" | "base" | "tipif" | "ventas" */
    kind: text("kind").notNull(),
    month: text("month").notNull(),
    version: integer("version").notNull(),
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(false),
    /** "validando" | "vigente" | "reemplazada" | "descartada" */
    status: text("status").notNull().default("validando"),
    fileName: text("file_name").notNull(),
    fileKey: text("file_key"),
    fileSha256: text("file_sha256").notNull(),
    rowsTotal: integer("rows_total").notNull().default(0),
    rowsValid: integer("rows_valid").notNull().default(0),
    rowsDiscarded: integer("rows_discarded").notNull().default(0),
    /** Lotes de filas ya recibidos (evita duplicar un lote reenviado). */
    chunksReceived: integer("chunks_received").notNull().default(0),
    /** Base adicional: queda vigente junto a la original en vez de reemplazarla. */
    isAddition: integer("is_addition", { mode: "boolean" }).notNull().default(false),
    /** Nombre de la base adicional ("Adicional 15 oct"). */
    label: text("label"),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("uploads_version_uq").on(t.dataset, t.month, t.version),
    index("uploads_current_idx").on(t.campaign, t.dataset, t.month, t.isCurrent),
  ],
);

export const baseRecords = sqliteTable(
  "base_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uploadId: text("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    campaign: text("campaign").notNull(),
    dataset: text("dataset").notNull(),
    month: text("month").notNull(),
    niu: text("niu").notNull(),
    profile: text("profile"),
    offer: text("offer"),
    extra: text("extra", { mode: "json" }),
  },
  (t) => [index("base_campaign_month_idx").on(t.campaign, t.month), index("base_niu_idx").on(t.niu), index("base_upload_idx").on(t.uploadId)],
);

export const bankSales = sqliteTable(
  "bank_sales",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uploadId: text("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    campaign: text("campaign").notNull(),
    month: text("month").notNull(),
    niu: text("niu").notNull(),
    /** Subproceso cuando la sábana lo separa (BASE/ONLINE, INCREMENTO/UPGRADE). */
    process: text("process"),
    saleDate: text("sale_date"),
    executive: text("executive"),
    agentId: integer("agent_id").references(() => agents.id),
    statusRaw: text("status_raw"),
    /** "aprobado" | "rechazado" | "en_proceso" */
    statusClass: text("status_class").notNull(),
    reason: text("reason"),
    daysInProcess: integer("days_in_process"),
    amount: real("amount"),
    extra: text("extra", { mode: "json" }),
  },
  (t) => [
    index("sales_campaign_month_idx").on(t.campaign, t.month),
    index("sales_niu_idx").on(t.niu),
    index("sales_agent_idx").on(t.campaign, t.month, t.agentId),
    index("sales_upload_idx").on(t.uploadId),
  ],
);

export const calls = sqliteTable(
  "calls",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uploadId: text("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    campaign: text("campaign").notNull(),
    month: text("month").notNull(),
    niu: text("niu").notNull(),
    agent: text("agent"),
    agentId: integer("agent_id").references(() => agents.id),
    calledAt: text("called_at"),
    category: text("category"),
    tipologia: text("tipologia"),
    /** "venta" | "negativo" | "no_efectivo" | "no_contacto" | "sin_tipificar" */
    callClass: text("call_class").notNull(),
    extra: text("extra", { mode: "json" }),
  },
  (t) => [
    index("calls_campaign_month_idx").on(t.campaign, t.month),
    index("calls_niu_idx").on(t.niu),
    index("calls_agent_idx").on(t.campaign, t.month, t.agentId),
    index("calls_upload_idx").on(t.uploadId),
  ],
);

export const crmSales = sqliteTable(
  "crm_sales",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    uploadId: text("upload_id")
      .notNull()
      .references(() => uploads.id, { onDelete: "cascade" }),
    campaign: text("campaign").notNull(),
    month: text("month").notNull(),
    niu: text("niu").notNull(),
    agent: text("agent"),
    agentId: integer("agent_id").references(() => agents.id),
    enteredAt: text("entered_at"),
    product: text("product"),
    extra: text("extra", { mode: "json" }),
  },
  (t) => [index("crm_campaign_month_idx").on(t.campaign, t.month), index("crm_niu_idx").on(t.niu), index("crm_upload_idx").on(t.uploadId)],
);

/* ---------- Cierres, reportes y bitácora ---------- */

/** Cifras oficiales congeladas de meses cerrados (abril–junio y siguientes). */
export const closings = sqliteTable(
  "closings",
  {
    campaign: text("campaign").notNull().references(() => campaigns.code),
    month: text("month").notNull(),
    metric: text("metric").notNull(),
    value: real("value").notNull(),
    source: text("source").notNull(),
    recordedBy: text("recorded_by").notNull(),
    recordedAt: integer("recorded_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.campaign, t.month, t.metric] })],
);

export const reportRuns = sqliteTable("report_runs", {
  id: text("id").primaryKey(),
  weekStart: text("week_start").notNull(),
  campaigns: text("campaigns", { mode: "json" }).notNull(),
  fileKey: text("file_key"),
  /** "generando" | "listo" | "error" */
  status: text("status").notNull().default("generando"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ts: integer("ts").notNull().default(now),
    userEmail: text("user_email"),
    action: text("action").notNull(),
    target: text("target"),
    detail: text("detail", { mode: "json" }),
  },
  (t) => [index("audit_ts_idx").on(t.ts)],
);
