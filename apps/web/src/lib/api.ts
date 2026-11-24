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

/** La base de datos de Cloudflare rechazó la consulta por exceso de trabajo en pocos segundos: se reintenta más despacio. */
export const baseOcupada = (e: unknown) => e instanceof ApiError && e.data.code === "base_ocupada";

/** Espera antes del reintento número i (desde 1): más larga si la base está ocupada, para no volver a saturarla. */
export const esperaReintento = (i: number, e: unknown) => (baseOcupada(e) ? 4000 * i : 800 * i);

/** Se avisa después de cada cambio guardado, para volver a pedir las cifras (ver main.tsx). */
let alEscribir: (() => void) | null = null;
export const avisarEscrituras = (f: () => void) => void (alEscribir = f);
/** Entrar/salir y los lotes de filas de una carga sin confirmar no cambian ninguna cifra. */
/** La gestión del seguimiento de documentación tampoco (no entra en ningún cálculo). */
const cambiaCifras = (method: string, path: string) => method !== "GET" && !path.startsWith("/auth/") && !/\/filas$/.test(path) && !path.startsWith("/seguimiento-documentacion/");

/** Cuándo se envió la última escritura (cargas, metas…): mientras se está cargando, la precarga espera. */
let ultimaEscritura = 0;
export const escribiendoHace = () => Date.now() - ultimaEscritura;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (method !== "GET" && !path.startsWith("/auth/")) ultimaEscritura = Date.now();
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

/** Seguimiento de documentación TDC (ver apps/api/src/seguimientoDoc.ts). */
export interface NotaDocumentacion {
  id: number;
  niu: string;
  venta: string;
  status: string;
  comentario: string | null;
  por: string;
  fecha: number;
}
export interface FilaDocumentacion {
  id: number;
  grupo: "seguimiento" | "productivas";
  niu: string;
  venta: string | null;
  nombre: string | null;
  digitos: string | null;
  requisito: string | null;
  subetapa: string | null;
  etapa: string | null;
  detalle: string | null;
  motivo: string | null;
  telefono: string | null;
  ejecutivo: string | null;
  llamadas: number;
  dias: number;
  ultimaLlamada: string | null;
  tipificacion: string | null;
  notas: NotaDocumentacion[];
  recibido: { por: string; fecha: number } | null;
  /** Departamento de la sábana, ya en la lista de departamentos (para la cita). */
  departamento: string | null;
  citas: CitaDocumentacion[];
}
/** Cita de entrega: una fila del archivo VISITA TDC. */
export interface CitaDocumentacion {
  id: number;
  niu: string;
  venta: string;
  fechaGestion: string;
  cliente: string | null;
  telefono: string;
  departamento: string;
  lugarEntrega: string;
  direccion: string;
  fechaCita: string;
  hora: string;
  comentario: string | null;
  por: string;
  fecha: number;
}
export interface NuevaCitaDocumentacion {
  niu: string;
  venta: string;
  telefono: string;
  departamento: string;
  lugar: string;
  direccion: string;
  fechaCita: string;
  hora: string;
  comentarioCita: string;
  /** Comentario de la gestión (STATUS SE REALIZA CITA). */
  comentario: string;
}
/** Un mes al mismo día (MTD): lo que cuenta para la meta del día 1 al `dia`, su meta y sus días hábiles. */
export interface MtdMes {
  month: string;
  dia: number;
  meta: number | null;
  logrado: number | null;
  diasHabiles: number;
  diasAlCorte: number;
}
/** Contacto de la base de un mes: clientes de la base llamados, con contacto efectivo y con venta (VICI). base null = sin base cargada. */
export interface ContactoBaseMes {
  month: string;
  base: number | null;
  llamados: number;
  contactados: number;
  ventas: number;
}
/** Llamadas de un mes por categoría, tipificación y subtipología. */
export interface TipologiaMes {
  month: string;
  categoria: string;
  tipologia: string;
  subtipologia: string;
  clase: string;
  llamadas: number;
  clientes: number;
}
export interface SeguimientoDocumentacion {
  /** Solo el dueño del CRM puede eliminar comentarios. */
  puedeEliminar: boolean;
  sabana: { month: string; archivo: string; cargada: number; corte: string | null } | null;
  filas: FilaDocumentacion[];
  historial: (NotaDocumentacion & { nombre: string | null; subetapa: string | null })[];
  citas: CitaDocumentacion[];
}

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
    ventas: { month: string; fecha: string | null; agente: string; estatus: string | null; clase: string; motivo: string | null; comentarios: string | null; motivoEsComentario: boolean; monto: number | null; proceso: string | null; dias: number | null; extra: Record<string, string | number> }[];
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
    /** Sábana: "Días transcurridos" de su hoja RESUMEN. */
    diasTranscurridos?: number;
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

  analysis: (campaign: string, month?: string | null, agent?: string | null, dias?: { desde: number; hasta: number } | null) => {
    const q = new URLSearchParams();
    if (month) q.set("mes", month);
    if (agent) q.set("agente", agent);
    if (dias) {
      q.set("desde", String(dias.desde));
      q.set("hasta", String(dias.hasta));
    }
    const qs = q.toString();
    return get<{ analysis: CampaignAnalysis }>(`/analisis/${campaign}${qs ? `?${qs}` : ""}`).then((r) => r.analysis);
  },
  /** Tipificaciones de los meses elegidos (Excel del histórico). */
  historicoTipologias: (campaign: string, meses: string[], agent?: string | null, dia?: number) =>
    get<{ meses: string[]; conTipificaciones: string[]; filas: TipologiaMes[]; contacto: ContactoBaseMes[]; mtd: MtdMes[] }>(
      `/analisis/${campaign}/historico/tipologias?meses=${meses.join(",")}${agent ? `&agente=${encodeURIComponent(agent)}` : ""}${dia ? `&dia=${dia}` : ""}`,
    ),
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
  /** Clientes por nombre, teléfono o DUI (y, si es un número, también como NIU). */
  buscarClientes: (q: string) =>
    get<{ tipo: "nombre" | "telefono"; resultados: { niu: string; nombre: string | null; telefono: string | null; dui: string | null; campanas: string[]; por: "niu" | "telefono" | "nombre" | "dui" }[] }>(`/clientes/buscar?q=${encodeURIComponent(q)}`),
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
  seguimientoDocumentacion: () => get<SeguimientoDocumentacion>("/seguimiento-documentacion"),
  gestionDocumentacion: (b: { niu: string; venta: string; status: string; comentario: string }) =>
    post<{ nota: NotaDocumentacion }>("/seguimiento-documentacion/notas", b).then((r) => r.nota),
  recibidoDocumentacion: (b: { niu: string; venta: string; recibido: boolean }) =>
    post<{ recibido: { por: string; fecha: number } | null }>("/seguimiento-documentacion/recibido", b).then((r) => r.recibido),
  eliminarGestionDocumentacion: (id: number) => post(`/seguimiento-documentacion/notas/${id}/eliminar`),
  agendarCitaDocumentacion: (b: NuevaCitaDocumentacion) => post<{ nota: NotaDocumentacion; cita: CitaDocumentacion }>("/seguimiento-documentacion/citas", b),
  eliminarCitaDocumentacion: (id: number) => post(`/seguimiento-documentacion/citas/${id}/eliminar`),
  setGoal: (b: { campaign: string; month: string; salesGoal: number; agents: number | null; countedStatuses: string[] | null; workDays: number[]; holidays: string[] }) =>
    request("PUT", "/metas", b),
};
