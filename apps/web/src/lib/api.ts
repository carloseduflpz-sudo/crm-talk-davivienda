/* Cliente de la API. La sesión viaja en una cookie segura que el navegador maneja solo. */
import type { DatasetDef, Permission, Role } from "@crm/core";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    // respuesta sin JSON
  }
  if (!res.ok) throw new ApiError(typeof data.error === "string" ? data.error : `Error ${res.status}`, res.status, data);
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body: unknown = {}) => request<T>("POST", path, body);
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);

export interface Me {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  permissions: Permission[];
  mustChangePassword: boolean;
}
export interface Health {
  ok: boolean;
  version: string;
  d1: boolean;
  r2: boolean;
}
export interface CampaignSummary {
  code: string;
  name: string;
  shortName: string;
  datasets: DatasetDef[];
}
export interface UserAccount {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  active: boolean;
  mustChangePassword: boolean;
  lockedUntil: number | null;
  lastLoginAt: number | null;
  createdAt: number;
}

export const api = {
  health: () => get<Health>("/health"),
  me: () => get<Me>("/me"),
  campaigns: () => get<{ campaigns: CampaignSummary[] }>("/campaigns").then((r) => r.campaigns),

  authStatus: () => get<{ needsSetup: boolean }>("/auth/estado"),
  setup: (b: { token: string; username: string; displayName: string; password: string }) => post("/auth/configurar", b),
  login: (b: { username: string; password: string }) => post<{ mustChangePassword: boolean }>("/auth/entrar", b),
  logout: () => post("/auth/salir"),
  changePassword: (b: { currentPassword: string; newPassword: string }) => post("/auth/cambiar-clave", b),

  users: () => get<{ users: UserAccount[] }>("/usuarios").then((r) => r.users),
  createUser: (b: { username: string; displayName: string; role: Role; password: string }) => post("/usuarios", b),
  updateUser: (id: number, b: Partial<{ displayName: string; role: Role; active: boolean; unlock: boolean }>) => patch(`/usuarios/${id}`, b),
  resetPassword: (id: number, password: string) => post(`/usuarios/${id}/clave`, { password }),
};
