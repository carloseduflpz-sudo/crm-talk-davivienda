-- Seguimiento de documentación: un comentario se puede eliminar (solo el dueño del CRM).
-- No se borra la fila: queda marcada con quién y cuándo, y deja de mostrarse y de descargarse.
ALTER TABLE doc_followup_notes ADD COLUMN deleted_at INTEGER;
ALTER TABLE doc_followup_notes ADD COLUMN deleted_by TEXT;
