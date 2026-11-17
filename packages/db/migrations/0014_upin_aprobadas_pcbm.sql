-- UPIN: aprobada = ya pasó PCBM (como el RESUMEN del banco). Las etapas de contrato y courier son aprobadas.
UPDATE status_map SET class = 'aprobado' WHERE campaign = 'upin' AND status_key IN ('NO SE HA GENERADO CONTRATO', 'EN PROCESO');
INSERT OR IGNORE INTO status_map (campaign, status_key, status, class) VALUES
  ('upin', 'NO SE HA GENERADO CONTRATO', 'NO SE HA GENERADO CONTRATO', 'aprobado'),
  ('upin', 'EN PROCESO', 'EN PROCESO', 'aprobado');
UPDATE bank_sales SET status_class = 'aprobado'
 WHERE campaign = 'upin' AND UPPER(TRIM(status_raw)) IN ('NO SE HA GENERADO CONTRATO', 'EN PROCESO');
