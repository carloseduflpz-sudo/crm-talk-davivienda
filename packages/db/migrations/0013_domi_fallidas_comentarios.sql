-- DOMI: todas las fallidas cuentan como fallidas (rechazo); la columna RECUPERADAS solo las separa por dentro.
UPDATE bank_sales SET status_raw = 'FALLIDA IRRECUPERABLE'
 WHERE campaign = 'domi' AND UPPER(COALESCE(json_extract(extra, '$.Recuperadas'), '')) LIKE '%IRRECUPER%' AND UPPER(status_raw) LIKE 'FALLID%';
UPDATE bank_sales SET status_class = 'rechazado'
 WHERE campaign = 'domi' AND UPPER(TRIM(status_raw)) LIKE 'FALLID%';
INSERT OR REPLACE INTO status_map (campaign, status_key, status, class) VALUES
  ('domi', 'FALLIDA RECUPERADA', 'FALLIDA RECUPERADA', 'rechazado'),
  ('domi', 'FALLIDA PENDIENTE', 'FALLIDA PENDIENTE', 'rechazado'),
  ('domi', 'FALLIDA IRRECUPERABLE', 'FALLIDA IRRECUPERABLE', 'rechazado');
DELETE FROM status_map WHERE campaign = 'domi' AND status_key = 'FALLIDA RECHAZADA';

-- CDC ya guardaba la columna COMENTARIOS: pasa a ser el motivo del rechazo.
UPDATE bank_sales SET reason = NULLIF(TRIM(json_extract(extra, '$.Comentarios')), '')
 WHERE campaign = 'cdc' AND reason IS NULL AND json_extract(extra, '$.Comentarios') IS NOT NULL;
