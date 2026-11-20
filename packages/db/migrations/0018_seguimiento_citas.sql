-- Seguimiento de documentación: citas de entrega (archivo VISITA TDC).
-- Guarda los datos del cliente como se agendaron. Al eliminarla (solo el dueño del CRM) queda marcada con quién y cuándo.
CREATE TABLE IF NOT EXISTS doc_followup_appointments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign       TEXT NOT NULL REFERENCES campaigns(code),
  niu            TEXT NOT NULL,
  sale_date      TEXT NOT NULL DEFAULT '',
  managed_on     TEXT NOT NULL,
  client_name    TEXT,
  phone          TEXT NOT NULL,
  department     TEXT NOT NULL,
  place          TEXT NOT NULL,
  address        TEXT NOT NULL,
  appointment_on TEXT NOT NULL,
  time_slot      TEXT NOT NULL,
  comment        TEXT,
  created_by     TEXT NOT NULL,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  deleted_by     TEXT,
  deleted_at     INTEGER
);
CREATE INDEX IF NOT EXISTS doc_followup_appointments_idx ON doc_followup_appointments (campaign, managed_on, deleted_at);
CREATE INDEX IF NOT EXISTS doc_followup_appointments_niu_idx ON doc_followup_appointments (campaign, niu, sale_date);
