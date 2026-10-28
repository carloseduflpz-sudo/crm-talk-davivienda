/* Cliente de la API. La sesión viaja en una cookie segura que el navegador maneja solo. */
import type { CampaignAnalysis, DatasetDef, MesOficial, MonthSummary, Oficial, Permission, PresentacionCampania, Role, SabanaSummary } from "@crm/core";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

/** Se avisa después de cada cambio guardado, para volver a pedir las cifras (ver main.tsx). */
let alEscribir: (() => void) | null = null;
export const avisarEscrituras = (f: () => void) => void (alEscribir = f);
/** Entrar/salir y los lotes de filas de una carga sin confirmar no cambian ninguna cifra. */
const cambiaCifras = (method: string, path: string) => method !== "GET" && !path.startsWith("/auth/") && !/\/filas$/.test(path);

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
  if (!res.ok) {
    if (typeof data.error === "string") throw new ApiError(data.error, res.status, data);
    // Sin JSON: la respuesta la cortó Cloudflare antes de llegar a la app (por ejemplo, límite de tiempo de CPU).
    throw new ApiError(
      res.status >= 500 ? `Cloudflare cortó la petición antes de terminar (error ${res.status}). Suele pasar cuando se excede un límite del plan.` : `Error ${res.status}`,
      res.status,
      data,
    );
  }
  if (cambiaCifras(method, path)) alEscribir?.();
  return data as T;
}

const get = <T>(path: string) => request<T>("GET", path);
const post = <T>(path: string, body: unknown = {}) => request<T>("POST", path, body);
const patch = <T>(path: string, body: unknown) => request<T>("PATCH", path, body);

export interface DetailResult {
  total: number;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number | null>[];
}

/** Ficha de un cliente (ver apps/api/src/clientes.ts). */
export interface ClientFile {
  niu: string;
  contacto: { nombre: string | null; telefono: string | null; telefonos: string[]; dui: string | null; correo: string | null; municipio: string | null; departamento: string | null };
  campanas: {
    campaign: string;
    /** Sábana vigente más reciente de la campaña: con ella está al día la ficha. */
    sabana: { month: string; cargada: number } | null;
    ventas: { month: string; fecha: string | null; agente: string; estatus: string | null; clase: string; motivo: string | null; monto: number | null; proceso: string | null; dias: number | null; extra: Record<string, string | number> }[];
    bases: { month: string; dataset: string; perfil: string | null; oferta: string | null; adicional: boolean; nombreBase: string | null; extra: Record<string, string | number> }[];
    llamadas: { month: string; fecha: string | null; agente: string; categoria: string | null; tipologia: string | null; clase: string }[];
    crm: { month: string; fecha: string | null; agente: string; producto: string | null; extra: Record<string, string | number> }[];
  }[];
}

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

export interface UploadInfo {
  id: string;
  campaign: string;
  dataset: string;
  kind: "base" | "sabana" | "tipif" | "ventas";
  month: string;
  version: number;
  isCurrent: boolean;
  status: "validando" | "vigente" | "reemplazada" | "descartada";
  fileName: string;
  hasFile: boolean;
  rowsTotal: number;
  rowsValid: number;
  rowsDiscarded: number;
  /** Base adicional: vigente junto a la original del mes. */
  isAddition: boolean;
  label: string | null;
  createdBy: string;
  createdAt: number;
}

/** Sube el Excel original como respaldo (cuerpo binario, no JSON). */
async function putFile(id: string, file: File): Promise<void> {
  const res = await fetch(`/api/cargas/${id}/archivo`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": file.type || "application/octet-stream", "x-crm-archivo": "1" },
    body: file,
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      // sin JSON
    }
    throw new ApiError(msg, res.status);
  }
}

export interface PlantillaInfo {
  nombre: string;
  /** Mes (AAAA-MM) de las cifras que trae la presentación. */
  mes: string | null;
  origen: "subida" | "generada";
  por: string;
  fecha: number;
  bytes: number;
}

async function errorOf(res: Response): Promise<ApiError> {
  let msg = `Error ${res.status}`;
  try {
    msg = ((await res.json()) as { error?: string }).error ?? msg;
  } catch {
    // sin JSON
  }
  return new ApiError(msg, res.status);
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
  updateUser: (id: number, b: Partial<{ displayName: string; username: string; role: Role; active: boolean; unlock: boolean }>) => patch(`/usuarios/${id}`, b),
  resetPassword: (id: number, password: string) => post(`/usuarios/${id}/clave`, { password }),

  uploads: (campaign?: string) => get<{ uploads: UploadInfo[] }>(`/cargas${campaign ? `?campana=${campaign}` : ""}`).then((r) => r.uploads),
  createUpload: (b: {
    campaign: string;
    dataset: string;
    month: string;
    fileName: string;
    fileSha256: string;
    rowsTotal: number;
    rowsValid: number;
    rowsDiscarded: number;
    mode?: "adicional" | "reemplazar";
    label?: string | null;
  }) =>
    post<{ id: string; version: number; maxRowsPerChunk: number }>("/cargas", b),
  sendRows: (id: string, seq: number, rows: unknown[]) => post<{ duplicate?: boolean }>(`/cargas/${id}/filas`, { seq, rows }),
  putFile,
  confirmUpload: (id: string) => post<{ upload: UploadInfo }>(`/cargas/${id}/confirmar`),
  discardUpload: (id: string) => post(`/cargas/${id}/descartar`),
  /** Elimina un archivo cargado (también el vigente): sus filas y su respaldo se borran. */
  deleteUpload: (id: string) => post(`/cargas/${id}/eliminar`),
  activateUpload: (id: string) => post(`/cargas/${id}/activar`),
  /** Resumen de una sábana cargada (para compararla con una nueva). */
  sabanaSummary: (id: string) => get<SabanaSummary>(`/cargas/${id}/resumen`),
  removeAddition: (id: string) => post(`/cargas/${id}/quitar`),

  analysis: (campaign: string, month?: string | null, agent?: string | null) => {
    const q = new URLSearchParams();
    if (month) q.set("mes", month);
    if (agent) q.set("agente", agent);
    const qs = q.toString();
    return get<{ analysis: CampaignAnalysis }>(`/analisis/${campaign}${qs ? `?${qs}` : ""}`).then((r) => r.analysis);
  },
  history: (campaign: string, agent?: string | null) =>
    get<{ meses: MonthSummary[] }>(`/analisis/${campaign}/historico${agent ? `?agente=${encodeURIComponent(agent)}` : ""}`).then((r) => r.meses),
  /** Todo lo que hay de un cliente: contacto, ventas, bases, llamadas y CRM (de una campaña o de todas). */
  presentacionDatos: (campaign: string, mes: string) =>
    get<{ datos: PresentacionCampania | null }>(`/presentacion/datos/${campaign}?mes=${mes}`).then((r) => r.datos),
  plantilla: () => get<{ plantilla: PlantillaInfo | null }>("/presentacion/plantilla").then((r) => r.plantilla),
  plantillaArchivo: async (): Promise<Uint8Array> => {
    const res = await fetch("/api/presentacion/plantilla/archivo", { credentials: "same-origin" });
    if (!res.ok) throw await errorOf(res);
    return new Uint8Array(await res.arrayBuffer());
  },
  guardarPlantilla: async (body: Blob, info: { mes: string | null; nombre: string; origen: "subida" | "generada" }): Promise<void> => {
    const res = await fetch("/api/presentacion/plantilla", {
      method: "PUT",
      credentials: "same-origin",
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "x-crm-archivo": "1",
        "x-mes": info.mes ?? "",
        "x-nombre": encodeURIComponent(info.nombre),
        "x-origen": info.origen,
      },
      body,
    });
    if (!res.ok) throw await errorOf(res);
  },
  control: () => get<{ control: { nombre: string; por: string; fecha: number; bytes: number } | null }>("/presentacion/control").then((r) => r.control),
  controlArchivo: async (): Promise<ArrayBuffer> => {
    const res = await fetch("/api/presentacion/control/archivo", { credentials: "same-origin" });
    if (!res.ok) throw await errorOf(res);
    return res.arrayBuffer();
  },
  guardarControl: async (file: File): Promise<void> => {
    const res = await fetch("/api/presentacion/control", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/octet-stream", "x-crm-archivo": "1", "x-nombre": encodeURIComponent(file.name) },
      body: file,
    });
    if (!res.ok) throw await errorOf(res);
  },
  quitarControl: () => post("/presentacion/control/quitar"),
  /** Metas y cumplimientos oficiales guardados, y las metas que ya tiene la app (ver apps/api/src/oficial.ts). */
  oficial: () => get<{ oficial: Oficial | null; metasApp: { campaign: string; month: string; meta: number }[] }>("/metas/oficial"),
  guardarOficial: (archivo: string, meses: MesOficial[]) => request<{ meses: number; metas: number }>("PUT", "/metas/oficial", { archivo, meses }),
  /** Clientes por nombre o teléfono (y, si es un número, también como NIU). */
  buscarClientes: (q: string) =>
    get<{ tipo: "nombre" | "telefono"; resultados: { niu: string; nombre: string | null; telefono: string | null; campanas: string[]; por: "niu" | "telefono" | "nombre" }[] }>(`/clientes/buscar?q=${encodeURIComponent(q)}`),
  client: (niu: string, campaign?: string | null) => get<ClientFile>(`/clientes/${encodeURIComponent(niu)}${campaign ? `?campana=${campaign}` : ""}`),
  /** Clientes detrás de una cifra (ver apps/api/src/detalle.ts para los filtros). */
  detail: (campaign: string, params: Record<string, string | string[] | number | null | undefined>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
      else if (v !== null && v !== undefined && v !== "") q.set(k, String(v));
    }
    return get<DetailResult>(`/analisis/${campaign}/detalle?${q}`);
  },
  setGoal: (b: { campaign: string; month: string; salesGoal: number; agents: number | null; countedStatuses: string[] | null; workDays: number[]; holidays: string[] }) =>
    request("PUT", "/metas", b),
};
