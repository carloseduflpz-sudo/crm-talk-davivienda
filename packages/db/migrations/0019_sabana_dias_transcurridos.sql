-- Corte del banco en la sábana: los "Días transcurridos" de su hoja RESUMEN (DOMI, CDC, Extra, Seguros).
-- Con él se mide el MTD aunque la sábana todavía no traiga ventas de los últimos días.
ALTER TABLE uploads ADD COLUMN bank_elapsed_days INTEGER;
