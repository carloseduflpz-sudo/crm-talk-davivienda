-- Login propio con usuario y contraseña (reemplaza a Cloudflare Access).
-- La tabla users de 0001 estaba vacía y se usaba por correo; se reemplaza por completo.

DROP TABLE IF EXISTS users;

CREATE TABLE users (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  username              TEXT NOT NULL UNIQUE,
  display_name          TEXT NOT NULL,
  role                  TEXT NOT NULL DEFAULT 'admin',
  password_hash         TEXT NOT NULL,
  must_change_password  INTEGER NOT NULL DEFAULT 1,
  active                INTEGER NOT NULL DEFAULT 1,
  failed_attempts       INTEGER NOT NULL DEFAULT 0,
  locked_until          INTEGER,
  last_login_at         INTEGER,
  created_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at            INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expires_idx ON sessions (expires_at);
