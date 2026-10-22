/* Roles y permisos. Hoy los 3 usuarios son "admin"; los demás roles quedan definidos
   para activarlos después sin rediseñar la API. */

export const ROLES = ["admin", "editor", "lector"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "datos:ver"
  | "datos:cargar"
  | "datos:restaurar"
  | "config:editar"
  | "reportes:generar"
  | "bitacora:ver"
  | "usuarios:administrar";

const GRANTS: Record<Role, readonly Permission[]> = {
  admin: ["datos:ver", "datos:cargar", "datos:restaurar", "config:editar", "reportes:generar", "bitacora:ver", "usuarios:administrar"],
  editor: ["datos:ver", "datos:cargar", "reportes:generar"],
  lector: ["datos:ver"],
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}

export function permissionsOf(role: Role): readonly Permission[] {
  return GRANTS[role];
}
