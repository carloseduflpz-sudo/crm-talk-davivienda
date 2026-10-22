-- Configuración de la meta de cada mes:
--   counted_statuses: JSON con los estatus de la sábana que cuentan para la meta (NULL = regla por defecto).
--   work_days: días de la semana que se trabajan, "1,2,3,4,5" (0 = domingo … 6 = sábado).
--   holidays: JSON con las fechas no laborables del mes ("AAAA-MM-DD").
ALTER TABLE goals ADD COLUMN counted_statuses TEXT;
ALTER TABLE goals ADD COLUMN work_days TEXT NOT NULL DEFAULT '1,2,3,4,5';
ALTER TABLE goals ADD COLUMN holidays TEXT NOT NULL DEFAULT '[]';
