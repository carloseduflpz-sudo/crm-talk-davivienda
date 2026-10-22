import type { Role } from "@crm/core";

/** Recursos y variables que Cloudflare entrega al Worker (ver wrangler.jsonc). */
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  /** "production" | "development" */
  APP_ENV: string;
  /**
   * Clave secreta de un solo uso para crear el primer administrador.
   * Se define en Cloudflare como *Secret* (nunca en el repositorio).
   * Cuando ya existe un usuario, deja de servir.
   */
  SETUP_TOKEN?: string;
}

export interface User {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword: boolean;
  /** Huella de la sesión con la que llegó la petición. */
  sessionId: string;
}
