-- UPIN: la devolución es un producto aprobado.
UPDATE status_map SET class = 'aprobado' WHERE campaign = 'upin' AND status_key = 'DEVOLUCION';
UPDATE bank_sales SET status_class = 'aprobado'
 WHERE campaign = 'upin' AND (UPPER(status_raw) LIKE '%DEVOLU%' OR UPPER(status_raw) LIKE '%DEVUELT%');

-- DOMI: las fallidas se separan con la columna RECUPERADAS (se aplica al volver a cargar la sábana).
INSERT OR REPLACE INTO status_map (campaign, status_key, status, class) VALUES
  ('domi', 'FALLIDA RECUPERADA', 'FALLIDA RECUPERADA', 'aprobado'),
  ('domi', 'FALLIDA RECHAZADA', 'FALLIDA RECHAZADA', 'rechazado'),
  ('domi', 'FALLIDA PENDIENTE', 'FALLIDA PENDIENTE', 'en_proceso');
