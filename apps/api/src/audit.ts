import type { Env } from "./env";

/** Registra un cambio en la bitácora. Nunca guarda datos de clientes en el detalle. */
export async function audit(env: Env, userEmail: string | null, action: string, target?: string, detail?: unknown): Promise<void> {
  await env.DB.prepare("INSERT INTO audit_log (ts, user_email, action, target, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(Date.now(), userEmail, action, target ?? null, detail === undefined ? null : JSON.stringify(detail))
    .run();
}
