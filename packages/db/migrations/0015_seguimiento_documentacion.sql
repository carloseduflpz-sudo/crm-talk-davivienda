-- Seguimiento de documentación (TDC): gestión de cada cliente de la cola de trabajo.
-- Cada registro es una gestión (STATUS homologado + comentario libre) de una venta (NIU + fecha de venta).
-- La más reciente es la que va en el consolidado; todas quedan en el historial.
CREATE TABLE IF NOT EXISTS doc_followup_notes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign    TEXT NOT NULL REFERENCES campaigns(code),
  niu         TEXT NOT NULL,
  sale_date   TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,
  comment     TEXT,
  created_by  TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
CREATE INDEX IF NOT EXISTS doc_followup_niu_idx ON doc_followup_notes (campaign, niu, sale_date, created_at);
