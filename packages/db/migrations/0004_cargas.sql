-- Centro de carga: las filas llegan por lotes numerados; este contador evita duplicar
-- un lote si el navegador lo reenvía tras un corte de conexión.
ALTER TABLE uploads ADD COLUMN chunks_received INTEGER NOT NULL DEFAULT 0;
