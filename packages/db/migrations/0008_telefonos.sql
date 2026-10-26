-- Llamadas sin NIU: el marcador de VICI deja más de la mitad de las llamadas sin id del cliente
-- (las que no llegaron a un agente, sin tipificar, parte del no contacto). Con el teléfono marcado
-- se sabe de qué cliente son: por otra llamada del mismo archivo que sí trae el NIU, o por los
-- teléfonos que trae la base del mes.
ALTER TABLE calls ADD COLUMN phone TEXT;
CREATE INDEX IF NOT EXISTS calls_upload_phone_idx ON calls (upload_id, phone);

-- Teléfonos de cada base (últimos 8 dígitos), sacados de sus columnas de teléfono o celular.
CREATE TABLE IF NOT EXISTS base_phones (
  upload_id TEXT NOT NULL REFERENCES uploads(id) ON DELETE CASCADE,
  niu TEXT NOT NULL,
  phone TEXT NOT NULL,
  PRIMARY KEY (upload_id, phone, niu)
);
CREATE INDEX IF NOT EXISTS base_phones_phone_idx ON base_phones (phone);

-- Bases a las que ya se les sacaron los teléfonos (para no repetirlo).
CREATE TABLE IF NOT EXISTS base_phones_listas (
  upload_id TEXT PRIMARY KEY REFERENCES uploads(id) ON DELETE CASCADE
);
