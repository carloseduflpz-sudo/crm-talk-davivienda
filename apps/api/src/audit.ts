import type { Env } from "./env";

/** Registra un cambio en la bitácora. Nunca guarda datos de clientes ni contraseñas. */
export async function audit(env: Pick<Env, "DB">, actor: string | null, action: string, target?: string, detail?: unknown): Promise<void> {
  await env.DB.prepare("INSERT INTO audit_log (ts, user_email, action, target, detail) VALUES (?, ?, ?, ?, ?)")
    .bind(Date.now(), actor, action, target ?? null, detail === undefined ? null : JSON.stringify(detail))
    .run();
}
