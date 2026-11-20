-- Seguimiento de documentación: "documento recibido" saca la venta (NIU + fecha de venta) de la cola de trabajo.
-- Si se desmarca, la fila no se borra: queda con quién y cuándo, y la venta vuelve a la cola.
CREATE TABLE IF NOT EXISTS doc_followup_received (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign     TEXT NOT NULL REFERENCES campaigns(code),
  niu          TEXT NOT NULL,
  sale_date    TEXT NOT NULL DEFAULT '',
  received_by  TEXT NOT NULL,
  received_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  undone_by    TEXT,
  undone_at    INTEGER
);
CREATE INDEX IF NOT EXISTS doc_followup_received_idx ON doc_followup_received (campaign, niu, sale_date, undone_at);
