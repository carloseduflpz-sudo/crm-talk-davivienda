import type { Role } from "@crm/core";

/** Recursos y variables que Cloudflare entrega al Worker (ver wrangler.jsonc). */
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  FILES: R2Bucket;
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ADMIN_EMAILS: string;
  /** "production" | "preview" | "development" */
  APP_ENV: string;
  /** Solo en desarrollo local (.dev.vars): "dev" salta Access y usa DEV_USER_EMAIL. */
  AUTH_MODE?: string;
  DEV_USER_EMAIL?: string;
}

export interface User {
  email: string;
  role: Role;
}

export interface AppContext {
  Bindings: Env;
  Variables: { user: User };
}
