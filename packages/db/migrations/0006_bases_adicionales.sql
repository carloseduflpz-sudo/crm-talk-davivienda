-- Bases adicionales: el banco a veces manda más clientes a mitad de mes. Una base adicional queda
-- vigente JUNTO a la original (no la reemplaza) y se identifica con un nombre.
ALTER TABLE uploads ADD COLUMN is_addition INTEGER NOT NULL DEFAULT 0;
ALTER TABLE uploads ADD COLUMN label TEXT;
