-- CDC y Extra: "NO DESEMBOLSADO" deja de ser rechazo y va como categoría propia (evaluada no desembolsada).
-- En Extra, "NO APLICA" es rechazo, igual que en CDC.
UPDATE status_map SET class = 'no_desembolsado'
 WHERE campaign IN ('cdc', 'extrafin') AND status_key = 'NO DESEMBOLSADO';

INSERT OR REPLACE INTO status_map (campaign, status_key, status, class) VALUES ('extrafin', 'NO APLICA', 'NO APLICA', 'rechazado');

UPDATE bank_sales SET status_class = 'no_desembolsado'
 WHERE campaign IN ('cdc', 'extrafin') AND UPPER(TRIM(status_raw)) = 'NO DESEMBOLSADO';

UPDATE bank_sales SET status_class = 'rechazado'
 WHERE campaign = 'extrafin' AND UPPER(TRIM(status_raw)) = 'NO APLICA';
