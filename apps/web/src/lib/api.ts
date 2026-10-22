/* Cliente de la API. Toda llamada sale con la cookie de Cloudflare Access. */
import type { DatasetDef, Permission, Role } from "@crm/core";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "same-origin", headers: { accept: "application/json" } });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // respuesta sin JSON
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `Error ${res.status}`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

export interface Me {
  email: string;
  role: Role;
  permissions: Permission[];
}
export interface Health {
  ok: boolean;
  version: string;
  d1: boolean;
  r2: boolean;
  access: boolean;
}
export interface CampaignSummary {
  code: string;
  name: string;
  shortName: string;
  datasets: DatasetDef[];
}

export const api = {
  me: () => get<Me>("/me"),
  health: () => get<Health>("/health"),
  campaigns: () => get<{ campaigns: CampaignSummary[] }>("/campaigns").then((r) => r.campaigns),
};
