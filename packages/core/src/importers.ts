/* ==================================================================
   LECTORES DE EXCEL — leen los archivos reales de cada campaña y los
   convierten en filas listas para guardar.
   Portado de la versión 1 (public/js/importers.js) sin cambiar las reglas:
   - Nunca se inventa un dato. Si falta una columna obligatoria, la lectura
     se detiene y se dice cuál falta.
   - Las filas sin NIU se descartan y se reportan.
   Tipos de archivo: base · sabana · tipif (VICI) · ventas (CRM TALK)
   ================================================================== */
import { getCampaign, type CampaignCode, type UploadKind } from "./campaigns";

/* ---------- lo mínimo de SheetJS que se usa (se inyecta, no se importa) ---------- */
export interface WorkBookLike {
  SheetNames: string[];
  Sheets: Record<string, unknown>;
}
export interface XLSXLike {
  utils: { sheet_to_json(ws: unknown, opts: Record<string, unknown>): unknown[][] };
}

type Cell = unknown;
export type RawRecord = Record<string, string | number | null>;

/* ---------- utilidades ---------- */
export function normHeader(h: unknown): string {
  return String(h ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
const isBlank = (v: Cell) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
const pad2 = (n: number) => String(n).padStart(2, "0");

interface DateParts {
  y: number;
  m: number;
  d: number;
  H?: number;
  M?: number;
  S?: number;
}

function fromSerial(n: number): DateParts {
  const d = new Date(Math.round((n - 25569) * 86400 * 1000));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), H: d.getUTCHours(), M: d.getUTCMinutes(), S: d.getUTCSeconds() };
}

/** Cualquier fecha a partes {y,m,d}. dmyHint=true → "05/06/2026" es 5 de junio (reportes del banco). */
export function dateParts(v: Cell, dmyHint = false): DateParts | null {
  if (isBlank(v)) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate(), H: v.getHours(), M: v.getMinutes(), S: v.getSeconds() };
  if (typeof v === "number" && v > 20000 && v < 80000) return fromSerial(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return { y: +m[1]!, m: +m[2]!, d: +m[3]!, H: +(m[4] ?? 0), M: +(m[5] ?? 0), S: +(m[6] ?? 0) };
  m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const a = +m[1]!,
      b = +m[2]!;
    let y = +m[3]!;
    if (y < 100) y += 2000;
    let d: number, mo: number;
    if (dmyHint) {
      d = a;
      mo = b;
      if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    } else {
      mo = a;
      d = b;
      if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return { y, m: mo, d, H: +(m[4] ?? 0), M: +(m[5] ?? 0), S: +(m[6] ?? 0) };
  }
  return null;
}

export function toISODate(v: Cell, dmy = false): string {
  const p = dateParts(v, dmy);
  return p ? `${p.y}-${pad2(p.m)}-${pad2(p.d)}` : "";
}
function toISODateTime(v: Cell, dmy = false): string {
  const p = dateParts(v, dmy);
  if (!p) return "";
  const base = `${p.y}-${pad2(p.m)}-${pad2(p.d)}`;
  return p.H || p.M || p.S ? `${base}T${pad2(p.H ?? 0)}:${pad2(p.M ?? 0)}:${pad2(p.S ?? 0)}` : base;
}
function toDMY(v: Cell, dmy = false): string {
  const p = dateParts(v, dmy);
  return p ? `${pad2(p.d)}/${pad2(p.m)}/${p.y}` : "";
}

export function niuOf(v: Cell): string {
  if (isBlank(v)) return "";
  let s = String(v).trim();
  if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, "");
  if (/^\d+(\.\d+)?e\+?\d+$/i.test(s)) s = String(Math.round(Number(s)));
  s = s.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(s)) return "";
  return s.replace(/^0+(?=\d)/, "");
}
function numOf(v: Cell): number | null {
  if (isBlank(v)) return null;
  if (typeof v === "number") return v;
  const s = String(v)
    .replace(/[$,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1");
  if (s === "" || s === "-") return null;
  const n = Number(s.replace("%", ""));
  return isNaN(n) ? null : s.endsWith("%") ? n / 100 : n;
}
function strOf(v: Cell): string {
  if (isBlank(v)) return "";
  if (v instanceof Date) return toISODate(v);
  const s = String(v).trim();
  return /^null$/i.test(s) ? "" : s; // el banco escribe "NULL" en celdas vacías
}

/* ---------- tipos de campo ---------- */
const T = {
  niu: (v: Cell) => niuOf(v),
  str: (v: Cell) => strOf(v),
  num: (v: Cell) => numOf(v),
  int: (v: Cell) => {
    const n = numOf(v);
    return n == null ? null : Math.round(n);
  },
  iso: (v: Cell) => toISODate(v, false),
  isoDMY: (v: Cell) => toISODate(v, true),
  isoDateTime: (v: Cell) => toISODateTime(v, false),
  dmy: (v: Cell) => toDMY(v, true),
  upper: (v: Cell) => strOf(v).toUpperCase(),
  /** fecha → ISO; si no es fecha se conserva el texto tal cual (ej. "-") */
  isoKeep: (v: Cell) => toISODate(v, false) || strOf(v),
  /** texto tal como viene; si Excel lo guardó como número de fecha → d/m/aaaa */
  rawdate: (v: Cell) => (typeof v === "number" ? toDMY(v, true) : strOf(v)),
} as const;
type FieldType = keyof typeof T;
type FieldSpec = [string | string[], FieldType?];

interface Profile {
  label: string;
  sheets?: string[];
  anySheet?: boolean;
  required: (string | string[])[];
  fields: Record<string, FieldSpec>;
  /** Campo que debe tener valor para conservar la fila (por defecto NIU). */
  keyField?: string;
  constants?: RawRecord;
  dashBlank?: boolean;
  transform?: (rec: RawRecord) => void;
  keep?: (rec: RawRecord) => boolean;
  monthField?: string;
  monthDMY?: boolean;
  multiSheet?: { sheet: string; process: string; required: (string | string[])[]; extra: Record<string, FieldSpec> }[];
  /** Columnas que solo trae este archivo (lo distinguen de otro parecido de la misma campaña). */
  markers?: string[];
  /** Nombre de archivo típico ("2a TDC", "BAU"...): si coincide, casi seguro es este. */
  fileHint?: RegExp;
  /** Para reconocerlo solo: además de las obligatorias, al menos `min` de estas columnas (evita confundirlo con cualquier archivo con NIU). */
  detectMin?: { min: number; cols: string[] };
}

/* ---------- perfiles ---------- */
const VICI: Profile = {
  label: "Tipificaciones (VICI)",
  sheets: ["Worksheet", "Hoja1", "Sheet1"],
  anySheet: true,
  // Dos exportaciones de VICI: la de siempre (id_base, full_name) y el "histórico outbound"
  // (id_cliente, user_name). Mismos datos con otros nombres de columna.
  required: [["id_base", "id_cliente"], "categoria", "tipologia", ["full_name", "user_name"], "call_date"],
  fields: {
    NIU: [["id_base", "id_cliente"], "niu"],
    Categoria: ["categoria"],
    Tipologia: ["tipologia"],
    Subtipologia: ["subtipologia"],
    Agente: [["full_name", "user_name"]],
    Fecha: ["call_date", "isoDateTime"],
  },
  transform(rec) {
    // El marcador automático no es un agente: esas llamadas quedan "Sin asignar".
    if (typeof rec.Agente === "string" && /^outbound auto ?dial$/i.test(rec.Agente.trim())) rec.Agente = null;
    if (!rec.Categoria) rec.Categoria = "Sin Tipificar";
    if (!rec.Tipologia) rec.Tipologia = "Sin Tipificar";
    if (!rec.Subtipologia) rec.Subtipologia = rec.Tipologia;
  },
  // Una llamada sin NIU se conserva (cuenta para contactabilidad); sin fecha se descarta.
  keyField: "Fecha",
  monthField: "Fecha",
};

const VENTAS_CRM: Profile = {
  label: "Ventas (CRM TALK)",
  sheets: ["Ventas"],
  anySheet: true,
  required: ["niu", "agente", ["fecha_ingreso", "fecha"]],
  fields: {
    NIU: ["niu", "niu"],
    Nombre: ["nombre_solicitante"],
    Agente: ["agente"],
    Fecha: [["fecha_ingreso", "fecha"], "iso"],
    FechaHora: [["fecha_ingreso"], "isoDateTime"],
    Producto: [["tarjeta_solicitada", "producto", "tipo_producto"]],
    Monto: [["monto_tarjeta_credito", "monto"], "num"],
    Perfil: [["perfil_campania", "perfil"]],
    Documentacion: [["tipo_documentacion"]],
    EstadoBackoffice: [["tipologia"]],
    Backoffice: [["backoffice"]],
    IdCRM: [["id"]],
  },
  transform(rec) {
    if (!rec.EstadoBackoffice) rec.EstadoBackoffice = "Sin procesar";
  },
  monthField: "Fecha",
};

const cols = (names: string[], niuName = "NIU", types: Record<string, FieldType> = {}): Record<string, FieldSpec> =>
  Object.fromEntries(names.map((h) => [h, [h, h === niuName ? "niu" : (types[h] ?? "str")] as FieldSpec]));

const TDC_DATE_COLS = [
  "F INGRESO CREACION DE EMPRESA",
  "F DE RECEPCIÓN DE DOCUMENTO(S)",
  "F DE REINGRESO PCBM",
  "F RESOLUCION PCBM",
  "F EMBOZO",
  "F DEVOLUCION",
  "F ENTREGA",
];
const TDC_SABANA_COLS = [
  "VENTA", "MES VENTA", "AÑO VENTA", "NOMBRE", "DUI OK", "Departamento", "BASE", "TC OFERTADA", "MARCA", "EJECUTIVO",
  "CORREO ELECTRONICO", "DOCUMENTACION", "TEL. VENTA REALIZADA", "CELULAR CLIENTE", "CASO SIGMA", "PENDIENTE POR REQUISITO",
  "SEGMENTO", "ASIGNACION", "PRI - SEG / CUENTA", "PSS", "CALIFICACION", "MARCA TDC", "FECHA VIGENCIA BASE", "VALIDADOR VIGENCIA",
  "RECHAZO HOMOLOGADO", "DIGITOS", "GRABADAS", "ZONA", "MOTIVO DEVOLUCION/OBSERVACIONES EXTRARREQUISITO/COMENTARIO GENERAL",
  "DETALLE DE LA DEVOLUCIÓN", "SUBETAPA", "ETAPA PRIMARIA", ...TDC_DATE_COLS,
];

export const PROFILES: Record<string, Profile> = {
  /* ===== TDC ===== */
  "tdc:sabana": {
    label: "Sábana TDC (Consolidado de ventas)",
    sheets: ["CONSOLIDADO DE VENTAS"],
    required: ["NIU", "VENTA", "SUBETAPA", "EJECUTIVO"],
    fields: {
      NIU: ["NIU", "niu"],
      ...Object.fromEntries(
        TDC_SABANA_COLS.map((h) => [
          h,
          [h, h === "VENTA" ? "dmy" : h === "FECHA VIGENCIA BASE" ? "iso" : TDC_DATE_COLS.includes(h) ? "isoKeep" : h === "MES VENTA" || h === "AÑO VENTA" ? "int" : "str"] as FieldSpec,
        ]),
      ),
      "CONTADOR DIAS": ["CONTADOR DIAS", "str"],
    },
    monthField: "VENTA",
    monthDMY: true,
  },
  "tdc:base:segundas": {
    label: "Base Segundas Cuentas (2a TDC)",
    sheets: ["2a TDC"],
    anySheet: true,
    markers: ["Nombre empresa", "Cargo", "Salario a Considerar", "Perfil SS", "Condicion", "Aplica CDC", "Tipo CDC", "ASIGNACION", "TelNotificaciones", "Dirección de Casa", "Dirección Lugar de Trabajo"],
    fileHint: /segund|(^|[^0-9])2\s*(a|da|nda)?[\s_.-]*(tdc|cuentas?|tarjetas?)/i,
    // Como la de Primeras: el formato de siempre (NIU, Nombre legal según IBS) o el "entregable" del banco (NIUCliente...).
    required: [["NIU", "NIUCliente", "NIU Cliente", "NIU_CLIENTE"]],
    detectMin: {
      min: 2,
      cols: [
        "Nombre legal según IBS", "NombreSociedad", "Nombre empresa", "Cargo", "Perfil", "Municipio", "Departamento", "TelNotificaciones", "Salario a Considerar",
        "DUI", "NumeroDUI", "Edad", "Tipo empresa", "Marca", "Tipo",
      ],
    },
    fields: {
      NIU: [["NIU", "NIUCliente", "NIU Cliente", "NIU_CLIENTE"], "niu"], DUI: [["DUI", "NumeroDUI", "Dui"]],
      Nombre: [["Nombre legal según IBS", "NombreSociedad", "Nombre", "Nombre Completo"]], NombreEmpresa: ["Nombre empresa"], Cargo: ["Cargo"],
      Municipio: ["Municipio"], Departamento: ["Departamento"], TelNotif: [["TelNotificaciones", "TEL Notificaciones", "Telefono", "Teléfono"]],
      Correo: [["Correo", "Correo Electrónico", "Correo Electronico"]], DireccionCasa: ["Dirección de Casa"], DireccionTrabajo: ["Dirección Lugar de Trabajo"],
      TipoEmpresa: [["Tipo empresa", "Segmento", "Segmento Empresa"]], Perfil: [["Perfil", "PERFIL"]], Tipo: [["Tipo", "Tipo Tarjeta", "Tipo de TC"]], Marca: ["Marca"],
      Limite: [["Limite", "Límite", "Limite TC", "Límite TC"], "num"], Salario: ["Salario a Considerar", "num"], Edad: ["Edad", "int"], PerfilSS: ["Perfil SS"],
      CI: [["CI", "Condicion"]], AplicaCDC: ["Aplica CDC"], TipoCDC: ["Tipo CDC"], BASE: ["BASE"], ASIGNACION: ["ASIGNACION"],
    },
  },
  "tdc:base:primeras": {
    label: "Base Primeras Cuentas (BAU)",
    sheets: [],
    anySheet: true,
    // Dos formatos: el de siempre (NIU, PERFIL, Oferta...) y el "entregable" del banco (NIUCliente, NombreSociedad, NumeroDUI...).
    markers: [
      "Producto Principal", "Oferta", "Monto2", "Tasa2", "Cuota", "Limite", "Score Tc", "CANAL", "Estrategia", "Correo", "TEL Notificaciones", "Plazo (meses)",
      "NIUCliente", "NombreSociedad", "NumeroDUI", "Clasificación Riesgo", "Cluster_TC",
    ],
    fileHint: /(^|[^a-z])bau([^a-z]|$)|primer|tarjetas?[\s_.-]*nuevas?|(^|[^0-9])1\s*(a|ra|era)?[\s_.-]*(tdc|cuentas?|tarjetas?)/i,
    dashBlank: true,
    required: [["NIU", "NIUCliente", "NIU Cliente", "NIU_CLIENTE"]],
    detectMin: {
      min: 2,
      cols: [
        "Perfil", "Municipio", "Departamento", "Correo", "Correo Electrónico", "TEL Notificaciones", "TelNotificaciones", "Oferta", "Limite", "Límite", "Marca",
        "Tipo", "Tipo Tarjeta", "Score Tc", "NombreSociedad", "Nombre legal según IBS", "DUI", "NumeroDUI", "Edad", "Segmento", "Tipo empresa", "Producto Principal",
      ],
    },
    fields: {
      NIU: [["NIU", "NIUCliente", "NIU Cliente", "NIU_CLIENTE"], "niu"], DUI: [["DUI", "NumeroDUI", "Dui"]], Municipio: ["Municipio"], Departamento: ["Departamento"],
      Correo: [["Correo", "Correo Electrónico", "Correo Electronico"]], "TEL Notificaciones": [["TEL Notificaciones", "TelNotificaciones", "Telefono", "Teléfono"]],
      "Tel. 1": [["Tel. 1", "Tel.1", "Telefono 1"]], "Producto Principal": ["Producto Principal"], Oferta: ["Oferta"],
      Monto2: [["Monto2", "Monto"], "num"], "Plazo (meses)": [["Plazo (meses)", "Plazo"]], Tasa2: [["Tasa2", "Tasa"]], Cuota: ["Cuota", "num"],
      Limite: [["Limite", "Límite", "Limite TC", "Límite TC"], "num"], "Score Tc": [["Score Tc", "Score TC", "Score"]], Edad: ["Edad", "int"], Genero: [["Genero", "Género"]],
      Marca: ["Marca"], Tipo: [["Tipo", "Tipo Tarjeta", "Tipo de TC"]], CANAL: ["CANAL"], Estrategia: ["Estrategia"],
      Nombre: [["Nombre legal según IBS", "NombreSociedad", "Nombre", "Nombre Completo"]], Perfil: [["PERFIL", "Perfil"]],
      Segmento: [["Tipo empresa", "Segmento", "Segmento Empresa"]], ClasifRiesgo: [["Clasificación Riesgo", "Clasificacion Riesgo"]], Cluster: [["Cluster_TC", "Cluster TC"]],
      BASE: [["BASE", "Base"]],
    },
  },
  "tdc:tipif": VICI,
  "tdc:ventas": VENTAS_CRM,

  /* ===== Extrafinanciamiento ===== */
  "extrafin:sabana": {
    label: "Sábana Extrafinanciamiento (Base + Extra Online)",
    required: [],
    multiSheet: [
      { sheet: "BASE", process: "BASE", required: ["NIU", "FECHA VENTA", "EJECUTIVO", "ETAPA (ADP)"], extra: { Etapa: ["ETAPA (ADP)"], Dias: ["Días en proceso", "int"], Motivo: ["MOTIVO"] } },
      { sheet: "EXTRA ONLINE", process: "ONLINE", required: ["NIU", "FECHA VENTA", "EJECUTIVO", "ETAPA"], extra: { Etapa: ["ETAPA"], Dias: ["__no__"], Motivo: ["__no__"] } },
    ],
    fields: {
      NIU: ["NIU", "niu"], Fecha: ["FECHA VENTA", "isoDMY"], Nombre: ["Nombre del cliente"], DUI: ["DUI"], Ejecutivo: ["EJECUTIVO"],
      Tarjeta: ["TIPO TC"], Monto: ["MONTO A DESEMBOLSAR", "num"],
    },
    monthField: "Fecha",
  },
  "extrafin:base": {
    label: "Base Extrafinanciamiento",
    sheets: [],
    anySheet: true,
    // El "Entregable" del banco trae el NIU como NIUCliente y otros nombres de columna.
    required: [["NIU", "NIUCliente"], ["Perfil", "PERFIL"]],
    fields: {
      NIU: [["NIU", "NIUCliente"], "niu"], Nombre: [["Nombre", "Nombre Completo", "Nombre legal según IBS", "NombreSociedad"]], DUI: [["DUI", "Dui", "NumeroDUI"]], Municipio: ["Municipio"],
      Departamento: ["Departamento"], Correo: [["Correo", "Correo Electrónico"]], Telefono: [["TelNotificaciones", "Telefono", "Teléfono"]],
      Perfil: [["Perfil", "PERFIL"]], Segmento: [["Segmento", "Segmento Empresa", "Tipo empresa"]], Monto: [["Monto", "Monto Oferta", "Monto Extra", "Monto Extrafinanciamiento"], "num"],
      Plazo: [["Plazo", "Plazo (Meses)"]], Tasa: [["Tasa", "Tasa Campaña"]], Pago: [["Pago", "Cuota"]], Tarjeta: [["Tarjeta", "Tipo de Producto", "Tipo Tarjeta"]], Edad: ["Edad", "int"],
      ClasifRiesgo: [["Clasificación Riesgo", "ClasifRiesgo", "Riesgo"]], AplicaCDC: ["Aplica CDC"], TipoCDC: ["Tipo CDC"], Base: [["BASE", "Base"]],
    },
  },
  "extrafin:tipif": VICI,
  "extrafin:ventas": VENTAS_CRM,

  /* ===== Compra de Cartera ===== */
  "cdc:sabana": {
    label: "Sábana Compra de Cartera",
    sheets: ["BASE"],
    required: ["NIU", "FECHA VENTA", "OPERADOR", "STATUS"],
    fields: {
      NIU: ["NIU", "niu"], Fecha: ["FECHA VENTA", "isoDMY"], Nombre: ["NOMBRE DEL CLIENTE"], Ejecutivo: ["OPERADOR"],
      Monto: ["MONTO APLICADO", "num"], MontoConsolidado: ["MONTO RECIBIDO EN CONSOLIDADO", "num"], Status: ["STATUS"],
      Base: ["BASE"], TipoCDC: ["TIPO CDC"], TipoAplicacion: ["TIPO APLICACION"], Comentarios: ["COMENTARIOS"],
    },
    monthField: "Fecha",
  },
  "cdc:base:cdc": {
    label: "Base Compra de Cartera",
    sheets: ["CDC"],
    required: ["NIU", "Tipo CDC", "Perfil"],
    fields: cols([
      "NIU", "Premium", "DUI", "Segmento Empresa", "Tipo de Producto", "Tipo de Oferta", "TC Competencia", "Deuda Comercial", "Perfil", "Tipo CDC",
      "Tasa CDC", "Límite CDC a trasladar", "Estatus", "Limite", "Disponible", "Genero", "Edad", "Nombre Completo", "TelNotificaciones", "Celular",
      "BASE", "CANAL", "Probabilidad de venta CDC",
    ]),
  },
  "cdc:base:bienvenida": {
    label: "Base Bienvenida",
    sheets: [],
    anySheet: true,
    required: ["Niu Cliente", "Origen de Base"],
    keyField: "Niu Cliente",
    fields: cols(
      [
        "Niu Cliente", "Portafolio", "Premium", "Segmento Empresa", "Segmento Cliente", "Domiciliación", "Origen de Base", "Producto", "Límite",
        "Saldo Actual", "Disponible", "DUI", "Nombre Completo", "Edad", "TelNotificaciones", "Correo", "Municipio", "Perfil", "Potencial de CDC",
        "Posee CDC", "Salario", "Fecha de Entrega", "Canal",
      ],
      "Niu Cliente",
      { "Fecha de Entrega": "iso" },
    ),
  },
  "cdc:tipif": VICI,
  "cdc:ventas": VENTAS_CRM,

  /* ===== UPIN ===== */
  "upin:sabana": {
    label: "Sábana UPIN (Incrementos + Upgrades)",
    required: [],
    multiSheet: [
      { sheet: "INCREMENTOS", process: "INCREMENTO", required: ["n", "FECHA", "EJECUTIVO", "STATUS TALK AMERICA"], extra: { NIU: ["n", "niu"] } },
      { sheet: "UPGRADES", process: "UPGRADE", required: ["B", "FECHA", "EJECUTIVO", "STATUS TALK AMERICA"], extra: { NIU: ["B", "niu"] } },
    ],
    fields: {
      Fecha: ["FECHA", "iso"], Nombre: ["NOMBRE DE CLIENTE"], Ejecutivo: ["EJECUTIVO"],
      Limite: ["LIMITE A OTORGAR", "num"], Status: ["STATUS TALK AMERICA", "upper"], Base: ["BASE"],
    },
    monthField: "Fecha",
  },
  "upin:base": {
    label: "Base Upgrade e Incrementos",
    sheets: ["UPIN"],
    anySheet: true,
    required: ["NIUCliente", "Tipo de Iniciativa"],
    keyField: "NIUCliente",
    fields: cols(
      [
        "NIUCliente", "Perfil", "Tipo de Iniciativa", "Límite Actual", "Mejor Límite", "Límite Máximo", "Clasificación Riesgo", "NombreSociedad",
        "NumeroDUI", "Municipio", "Departamento", "Correo", "TelNotificaciones", "Tel. 1", "Cluster_TC", "Premium", "Tipo Tarjeta", "BASE",
      ],
      "NIUCliente",
    ),
  },
  "upin:tipif": VICI,
  "upin:ventas": VENTAS_CRM,

  /* ===== Seguros ===== */
  "seguros:sabana": {
    label: "Sábana Seguros",
    sheets: ["BASE"],
    required: ["NIU", "EJECUTIVO", "STATUS", "TIPO DE SEGURO"],
    fields: {
      NIU: ["NIU", "niu"], Nombre: ["NOMBRE"], Ejecutivo: ["EJECUTIVO"], Fecha: ["FECHA", "isoDMY"],
      TipoSeguro: ["TIPO DE SEGURO"], Plan: ["PLAN"], Tarjeta: ["TARJETA"], Status: ["STATUS"],
    },
    monthField: "Fecha",
  },
  "seguros:base": {
    label: "Base Compras y Retiros Protegidos",
    sheets: [],
    anySheet: true,
    required: ["NIU", "Oferta Todo Protegido"],
    fields: cols([
      "NIU", "Nombre", "Dui", "Edad", "Rango Ingresos", "Perfil", "Segmento Empresa", "Correo Electrónico", "TelNotificaciones", "Tel.1", "Genero",
      "Contratacion_Seguro_Todo_Protegido", "Oferta Todo Protegido", "Cluster TC", "BASE", "Tipo de TC",
    ]),
  },
  "seguros:tipif": VICI,
  "seguros:ventas": VENTAS_CRM,

  /* ===== Domiciliaciones ===== */
  "domi:sabana": {
    label: "Sábana Domiciliaciones",
    sheets: ["TALK AMERICAS"],
    required: ["NIU", "Usuarios", "COLECTOR"],
    fields: {
      NIU: ["NIU", "niu"], Nombre: ["NOMBRE"], Usuario: ["Usuarios"], Colector: ["COLECTOR"], Fecha: ["FECHA", "rawdate"],
      Monto: ["MONTO A PAGAR", "str"], Status: [["COMENTARIO BANCO", "STATUS DOMI SEGUN SISTEMA", "STATUS"], "upper"],
    },
    monthField: "Fecha",
    monthDMY: true,
  },
  "domi:base:domi": {
    label: "Base Domiciliaciones",
    sheets: ["Domiciliaciones", "Hoja1"],
    anySheet: true,
    required: ["NIU", "Colectores que paga"],
    fields: cols([
      "NIU", "Nombre", "DUI", "Perfil", "Segmento Empresa", "Edad", "Municipio", "Departamento", "Correo", "TelNotificaciones", "Tel.1",
      "Domi Activa", "Colectores que paga", "Base", "Mayor Prob. Aceptación", "Limite",
    ]),
  },
  "domi:base:piloto": {
    label: "Base Piloto (mes vencido)",
    sheets: ["Complementarios TALK"],
    anySheet: true,
    required: ["F. Embozo", "NIU", "Estado"],
    fields: {
      FEmbozo: ["F. Embozo", "iso"], Cliente: ["Cliente"], NIU: ["NIU", "niu"], Cuenta: ["Cuenta"], Telefono: ["Telefono"],
      Telefono2: ["Telefono2"], Telefono3: ["Telefono3"], Estado: ["Estado"], Fecha: ["Fecha/Hora", "iso"], Hora: ["HORA"],
    },
    monthField: "FEmbozo",
  },
  "domi:tipif": VICI,
  "domi:ventas": VENTAS_CRM,
};

/* ---------- lectura ---------- */

/** Libro con sus hojas ya convertidas a filas (se convierte una sola vez por hoja). */
export class WorkbookReader {
  private cache = new Map<string, Cell[][]>();
  constructor(
    private XLSX: XLSXLike,
    readonly wb: WorkBookLike,
  ) {}
  get sheetNames() {
    return this.wb.SheetNames;
  }
  rows(sheet: string): Cell[][] {
    let r = this.cache.get(sheet);
    if (!r) {
      r = this.XLSX.utils.sheet_to_json(this.wb.Sheets[sheet], { header: 1, raw: true, defval: null, blankrows: false }) as Cell[][];
      this.cache.set(sheet, r);
    }
    return r;
  }
  pickSheet(names: string[]): string | null {
    const want = names.map(normHeader);
    return this.wb.SheetNames.find((sn) => want.includes(normHeader(sn))) ?? null;
  }
}

interface HeaderHit {
  at: number;
  idx: Map<string, number>;
}

/** Fila de encabezados: la primera (de las 15 primeras) que tenga TODOS los obligatorios. */
function findHeader(rows: Cell[][], required: (string | string[])[]): HeaderHit | null {
  const req = required.map((r) => (Array.isArray(r) ? r.map(normHeader) : [normHeader(r)]));
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const idx = new Map<string, number>();
    (rows[i] ?? []).forEach((c, j) => {
      const k = normHeader(c);
      if (k && !idx.has(k)) idx.set(k, j);
    });
    if (req.every((alts) => alts.some((a) => idx.has(a)))) return { at: i, idx };
  }
  return null;
}

export interface ParseResult {
  rows: RawRecord[];
  /** Filas descartadas por no tener NIU (o fecha, en VICI). */
  dropped: number;
  sheet: string;
  /** Columnas opcionales que el archivo no trae. */
  missingOptional: string[];
  /** Hojas cuyos clientes ya vienen en la hoja principal (cargas o asignaciones parciales): no se suman. */
  covered?: string[];
}
export type ParseOutcome = ParseResult | { error: string };

const labelOf = (r: string | string[]) => (Array.isArray(r) ? r.join(" o ") : r);

/** Columnas obligatorias que no están en la fila que más se parece a un encabezado (para el mensaje de error). */
function missingRequired(rows: Cell[][], required: (string | string[])[]): string[] {
  let best: string[] = required.map(labelOf);
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const have = new Set((rows[i] ?? []).map(normHeader));
    const miss = required.filter((r) => !(Array.isArray(r) ? r : [r]).some((c) => have.has(normHeader(c)))).map(labelOf);
    if (miss.length < best.length) best = miss;
  }
  return best;
}

function readWithProfile(reader: WorkbookReader, prof: Profile, sheet: string): ParseOutcome {
  const rows = reader.rows(sheet);
  const hdr = findHeader(rows, prof.required);
  if (!hdr) return { error: `En la hoja "${sheet}" faltan columnas obligatorias: ${missingRequired(rows, prof.required).join(", ")}.` };

  const colOf: Record<string, number> = {};
  const missingOptional: string[] = [];
  for (const [dest, spec] of Object.entries(prof.fields)) {
    const cands = (Array.isArray(spec[0]) ? spec[0] : [spec[0]]).map(normHeader);
    const found = cands.find((c) => hdr.idx.has(c));
    if (found !== undefined) colOf[dest] = hdr.idx.get(found)!;
    else if (spec[0] !== "__no__") missingOptional.push(dest);
  }

  const out: RawRecord[] = [];
  let dropped = 0;
  const key = prof.keyField ?? "NIU";
  for (let i = hdr.at + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];
    if (r.every(isBlank)) continue;
    const rec: RawRecord = {};
    for (const [dest, spec] of Object.entries(prof.fields)) {
      const type = spec[1] ?? "str";
      const raw = colOf[dest] === undefined ? null : r[colOf[dest]!];
      let val: string | number | null = T[type](raw);
      if (prof.dashBlank && (val === "-" || val === "--")) val = "";
      rec[dest] = val === null ? (type === "num" || type === "int" ? null : "") : val;
    }
    if (prof.constants) Object.assign(rec, prof.constants);
    prof.transform?.(rec);
    if (!rec[key] || (prof.keep && !prof.keep(rec))) {
      dropped++;
      continue;
    }
    out.push(rec);
  }
  return { rows: out, dropped, sheet, missingOptional };
}

/** Lee un libro con el perfil del conjunto de datos indicado (p. ej. "tdc:sabana"). */
export function parseWorkbook(reader: WorkbookReader, datasetId: string): ParseOutcome {
  const prof = PROFILES[datasetId];
  if (!prof) return { error: `Tipo de archivo desconocido: ${datasetId}` };

  if (prof.multiSheet) {
    const all: RawRecord[] = [];
    let dropped = 0;
    const used: string[] = [];
    for (const part of prof.multiSheet) {
      const sn = reader.pickSheet([part.sheet]);
      if (!sn) continue;
      const sub: Profile = { ...prof, required: part.required, fields: { ...prof.fields, ...part.extra }, constants: { Proceso: part.process } };
      const r = readWithProfile(reader, sub, sn);
      if ("error" in r) return r;
      all.push(...r.rows);
      dropped += r.dropped;
      used.push(sn);
    }
    if (!used.length) return { error: `No encontré las hojas ${prof.multiSheet.map((p) => `"${p.sheet}"`).join(" ni ")} en el archivo.` };
    return { rows: all, dropped, sheet: used.join(" + "), missingOptional: [] };
  }

  const sheets = sheetsFor(reader, datasetId);
  if (!sheets.length) {
    return {
      error: `No encontré la hoja esperada (${(prof.sheets ?? []).join(", ") || "con los encabezados correctos"}). Hojas del archivo: ${reader.sheetNames.join(", ")}.`,
    };
  }
  if (sheets.length === 1) return readWithProfile(reader, prof, sheets[0]!);
  // Varias hojas con las mismas columnas. Dos casos:
  //  - una hoja consolidada y otras con partes de ella (cargas, empresas, asignaciones): se usa la consolidada y
  //    a cada cliente se le anota en qué otras hojas venía;
  //  - la base partida en varias hojas (una por segmento): se juntan, sin repetir clientes.
  const key = prof.keyField ?? "NIU";
  const parts: { sheet: string; r: ParseResult; nius: Set<string> }[] = [];
  for (const sn of sheets) {
    const r = readWithProfile(reader, prof, sn);
    if ("error" in r) continue;
    parts.push({ sheet: sn, r, nius: new Set(r.rows.map((x) => String(x[key] ?? ""))) });
  }
  if (!parts.length) return readWithProfile(reader, prof, sheets[0]!);
  if (parts.length === 1) return parts[0]!.r;
  const union = new Set(parts.flatMap((p) => [...p.nius]));
  const main = [...parts].sort((a, b) => b.nius.size - a.nius.size)[0]!;
  const sheetsOf = new Map<string, string[]>();
  for (const p of parts) if (p !== main) for (const n of p.nius) sheetsOf.set(n, [...(sheetsOf.get(n) ?? []), p.sheet]);
  if (main.nius.size >= union.size * 0.95) {
    const others = parts.filter((p) => p !== main).map((p) => p.sheet);
    const rows = main.r.rows.map((x) => {
      const en = sheetsOf.get(String(x[key] ?? ""));
      return en ? { ...x, Cargas: en.join(", ") } : x;
    });
    return { rows, dropped: main.r.dropped, sheet: main.sheet, missingOptional: main.r.missingOptional, covered: others };
  }
  const seen = new Set<string>();
  const all: RawRecord[] = [];
  let dropped = 0;
  let missingOptional: string[] | null = null;
  for (const p of parts) {
    dropped += p.r.dropped;
    missingOptional = missingOptional === null ? p.r.missingOptional : missingOptional.filter((m) => p.r.missingOptional.includes(m));
    for (const x of p.r.rows) {
      const n = String(x[key] ?? "");
      if (seen.has(n)) continue;
      seen.add(n);
      all.push({ ...x, Hoja: p.sheet });
    }
  }
  return { rows: all, dropped, sheet: parts.map((p) => p.sheet).join(" + "), missingOptional: missingOptional ?? [] };
}

/** Parecido de una hoja con un perfil: columnas en común, columnas exclusivas y nombre de hoja esperado. */
function sheetScore(reader: WorkbookReader, prof: Profile, sn: string): number {
  const rows = reader.rows(sn);
  if (!findHeader(rows, prof.required)) return -1;
  if (prof.detectMin) {
    const hdr = findHeader(rows, prof.required)!;
    if (prof.detectMin.cols.filter((c) => hdr.idx.has(normHeader(c))).length < prof.detectMin.min) return -1;
  }
  const named = (prof.sheets ?? []).map(normHeader).includes(normHeader(sn));
  // El nombre de la hoja también cuenta ("BAU", "2a TDC", "Segundas"...).
  return coverage(rows, prof, prof.required) + markerHits(rows, prof) + (named ? 5 : 0) + (prof.fileHint?.test(sn) ? 2 : 0);
}

/**
 * Hojas que se leen para ese tipo de archivo. Una base puede venir repartida en varias hojas con los mismos
 * encabezados: se leen todas las que se le parecen, salvo las que se parecen más a OTRA base de la misma
 * campaña (un libro con Primeras y Segundas Cuentas no se mezcla).
 */
function sheetsFor(reader: WorkbookReader, datasetId: string): string[] {
  const prof = PROFILES[datasetId]!;
  const best = bestSheet(reader, prof);
  const campaign = datasetId.split(":")[0] as CampaignCode;
  let def;
  try {
    def = getCampaign(campaign).datasets.find((d) => d.id === datasetId);
  } catch {
    def = undefined;
  }
  if (!prof.anySheet || def?.kind !== "base") return best ? [best] : [];
  const siblings = getCampaign(campaign)
    .datasets.filter((d) => d.kind === "base" && d.id !== datasetId && PROFILES[d.id])
    .map((d) => PROFILES[d.id]!);
  if (!best) return [];
  // Solo se juntan hojas con LAS MISMAS columnas que la hoja principal (la misma base partida en varias hojas).
  // Una hoja con otras columnas es otro archivo (p. ej. la base de la otra cuenta) y nunca se suma.
  const cols = headerSet(reader, prof, best);
  const mine = reader.sheetNames.filter((sn) => {
    if (sn === best) return true;
    // Una hoja que por su nombre es de otra base ("2a TDC", "Segundas") no se suma.
    if (siblings.some((sp) => sp.fileHint?.test(sn)) && !prof.fileHint?.test(sn)) return false;
    const own = sheetScore(reader, prof, sn);
    if (own < 0 || !siblings.every((sp) => sheetScore(reader, sp, sn) <= own)) return false;
    return similarity(cols, headerSet(reader, prof, sn)) >= 0.9;
  });
  return mine;
}

/** Encabezados (normalizados) de la fila de títulos de una hoja. */
function headerSet(reader: WorkbookReader, prof: Profile, sn: string): Set<string> {
  const rows = reader.rows(sn);
  const hdr = findHeader(rows, prof.required);
  return hdr ? new Set(hdr.idx.keys()) : new Set();
}

/** Qué tanto se parecen dos juegos de columnas (0 a 1). */
function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
}

/** A qué tipo de archivo va cada hoja del libro (para mostrarlo al cargar). */
export function sheetAssignments(reader: WorkbookReader, detections: Detection[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const d of detections) for (const sn of neededSheets(reader, d.datasetId)) (out[sn] ??= []).push(d.datasetId);
  return out;
}

/** Hojas que `parseWorkbook` va a leer para ese tipo de archivo. Basta con los encabezados, así que
    funciona con un libro abierto solo con sus primeras filas: después se lee completo SOLO lo necesario. */
export function neededSheets(reader: WorkbookReader, datasetId: string): string[] {
  const prof = PROFILES[datasetId];
  if (!prof) return [];
  if (prof.multiSheet) return prof.multiSheet.map((p) => reader.pickSheet([p.sheet])).filter((s): s is string => Boolean(s));
  return sheetsFor(reader, datasetId);
}

/** Cuántas columnas exclusivas de este archivo trae la hoja. */
function markerHits(rows: Cell[][], prof: Profile): number {
  if (!prof.markers?.length) return 0;
  const hdr = findHeader(rows, prof.required);
  return hdr ? prof.markers.filter((m) => hdr.idx.has(normHeader(m))).length : 0;
}

/**
 * La hoja que se lee: la del nombre esperado si trae los encabezados; si no (y se permite cualquier hoja),
 * la que más se parece a este archivo. Así, en un libro con la base de primeras Y la de segundas,
 * cada tipo toma su propia hoja y no la primera que encuentre.
 */
function bestSheet(reader: WorkbookReader, prof: Profile): string | null {
  const named = reader.pickSheet(prof.sheets ?? []);
  if (named && findHeader(reader.rows(named), prof.required)) return named;
  if (!prof.anySheet) return named;
  let best: string | null = null;
  let bestScore = -1;
  for (const cand of reader.sheetNames) {
    const rows = reader.rows(cand);
    if (!findHeader(rows, prof.required)) continue;
    const score = coverage(rows, prof, prof.required) + markerHits(rows, prof) + (prof.fileHint?.test(cand) ? 2 : 0);
    if (score > bestScore) (best = cand), (bestScore = score);
  }
  return best ?? named;
}

/* ---------- reconocimiento automático ---------- */

export interface Detection {
  datasetId: string;
  label: string;
  sheet: string;
  /** Más alto = más seguro. Coincidir el nombre de la hoja pesa más que solo los encabezados. */
  score: number;
}

/** Qué parte de las columnas del perfil trae la hoja (0 a 1): desempata perfiles parecidos. */
function coverage(rows: Cell[][], prof: Profile, required: (string | string[])[]): number {
  const hdr = findHeader(rows, required);
  if (!hdr) return 0;
  const specs = Object.values(prof.fields).filter((s) => s[0] !== "__no__");
  const hit = specs.filter((s) => (Array.isArray(s[0]) ? s[0] : [s[0]]).some((c) => hdr.idx.has(normHeader(c)))).length;
  return specs.length ? hit / specs.length : 0;
}

/** Encabezados que trae el libro (la fila más llena de las primeras de cada hoja): para explicar por qué no se reconoció. */
export function headerPreview(reader: WorkbookReader, maxSheets = 3, maxCols = 30): string {
  return reader.sheetNames
    .slice(0, maxSheets)
    .map((sn) => {
      const rows = reader.rows(sn).slice(0, 15);
      const best = rows.reduce<Cell[]>((b, r) => ((r ?? []).filter((c) => !isBlank(c)).length > b.filter((c) => !isBlank(c)).length ? (r ?? []) : b), []);
      const cols = best.filter((c) => !isBlank(c)).map((c) => String(c).trim());
      return cols.length ? `Hoja "${sn}": ${cols.slice(0, maxCols).join(", ")}${cols.length > maxCols ? "…" : ""}` : `Hoja "${sn}": vacía`;
    })
    .join(" | ");
}

/** Qué tipos de archivo de la campaña coinciden con el libro, del más probable al menos. */
export function detectDatasets(reader: WorkbookReader, campaign: CampaignCode, fileName = ""): Detection[] {
  const found: Detection[] = [];
  for (const ds of getCampaign(campaign).datasets) {
    const prof = PROFILES[ds.id];
    if (!prof) continue;
    if (prof.multiSheet) {
      const parts = prof.multiSheet.filter((p) => {
        const sn = reader.pickSheet([p.sheet]);
        return sn && findHeader(reader.rows(sn), p.required);
      });
      if (parts.length) found.push({ datasetId: ds.id, label: ds.label, sheet: parts.map((p) => p.sheet).join(" + "), score: 20 + parts.length * 5 });
      continue;
    }
    const named = reader.pickSheet(prof.sheets ?? []);
    const sheet = bestSheet(reader, prof);
    if (!sheet || !findHeader(reader.rows(sheet), prof.required)) continue;
    const rows = reader.rows(sheet);
    if (prof.detectMin) {
      const hdr = findHeader(rows, prof.required)!;
      if (prof.detectMin.cols.filter((c) => hdr.idx.has(normHeader(c))).length < prof.detectMin.min) continue;
    }
    // Hoja con el nombre esperado, columnas obligatorias, parecido general, columnas exclusivas y nombre del archivo.
    const score =
      (sheet === named ? 10 : 0) +
      prof.required.length * 2 +
      coverage(rows, prof, prof.required) * 5 +
      markerHits(rows, prof) * 3 +
      (fileName && prof.fileHint?.test(fileName) ? 15 : 0);
    found.push({ datasetId: ds.id, label: ds.label, sheet, score });
  }
  return found.sort((a, b) => b.score - a.score);
}

/** Mes (AAAA-MM) más frecuente en los registros, para sugerir el mes de la carga. */
export function dominantMonth(rows: RawRecord[], datasetId: string): { month: string; share: number; byMonth: Record<string, number> } | null {
  const prof = PROFILES[datasetId];
  const f = prof?.monthField;
  if (!f || !rows.length) return null;
  const count: Record<string, number> = {};
  for (const r of rows) {
    const p = dateParts(r[f], Boolean(prof.monthDMY));
    if (p) {
      const k = `${p.y}-${pad2(p.m)}`;
      count[k] = (count[k] ?? 0) + 1;
    }
  }
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  return best ? { month: best[0], share: best[1] / rows.length, byMonth: count } : null;
}

/* ---------- normalización a las tablas de la base ---------- */

type Extra = Record<string, string | number>;
export interface BaseRow {
  niu: string;
  profile: string | null;
  offer: string | null;
  extra: Extra;
}
export interface SaleRow {
  niu: string;
  process: string | null;
  saleDate: string | null;
  executive: string | null;
  statusRaw: string | null;
  reason: string | null;
  daysInProcess: number | null;
  amount: number | null;
  extra: Extra;
}
export interface CallRow {
  niu: string;
  agent: string | null;
  calledAt: string | null;
  category: string | null;
  tipologia: string | null;
  extra: Extra;
}
export interface CrmRow {
  niu: string;
  agent: string | null;
  enteredAt: string | null;
  product: string | null;
  extra: Extra;
}
export type NormalizedRow = BaseRow | SaleRow | CallRow | CrmRow;

/** Qué columna del archivo alimenta cada campo de la tabla, por conjunto de datos. */
interface SaleMap {
  status: string;
  date: string;
  dateDMY?: boolean;
  executive: string;
  reason?: string;
  days?: string;
  amount?: string;
  process?: string;
}
const SALE_MAP: Record<CampaignCode, SaleMap> = {
  tdc: { status: "SUBETAPA", date: "VENTA", dateDMY: true, executive: "EJECUTIVO", reason: "RECHAZO HOMOLOGADO", days: "CONTADOR DIAS" },
  extrafin: { status: "Etapa", date: "Fecha", executive: "Ejecutivo", reason: "Motivo", days: "Dias", amount: "Monto", process: "Proceso" },
  cdc: { status: "Status", date: "Fecha", executive: "Ejecutivo", amount: "Monto" },
  upin: { status: "Status", date: "Fecha", executive: "Ejecutivo", amount: "Limite", process: "Proceso" },
  seguros: { status: "Status", date: "Fecha", executive: "Ejecutivo" },
  domi: { status: "Status", date: "Fecha", dateDMY: true, executive: "Usuario" },
};
const BASE_MAP: Record<string, { niu?: string; profile?: string; offer?: string }> = {
  "tdc:base:primeras": { profile: "Perfil", offer: "Oferta" },
  "tdc:base:segundas": { profile: "Perfil", offer: "Tipo" },
  "extrafin:base": { profile: "Perfil", offer: "Tarjeta" },
  "cdc:base:cdc": { profile: "Perfil", offer: "Tipo CDC" },
  "cdc:base:bienvenida": { niu: "Niu Cliente", profile: "Perfil", offer: "Producto" },
  "upin:base": { niu: "NIUCliente", profile: "Perfil", offer: "Tipo de Iniciativa" },
  "seguros:base": { profile: "Perfil", offer: "Oferta Todo Protegido" },
  "domi:base:domi": { profile: "Perfil", offer: "Colectores que paga" },
  "domi:base:piloto": { offer: "Estado" },
};

const text = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const intOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : null;
};
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Todo lo que el archivo trae y no tiene columna propia, sin celdas vacías. */
function extraOf(rec: RawRecord, used: (string | undefined)[]): Extra {
  const skip = new Set(used.filter(Boolean));
  const out: Extra = {};
  for (const [k, v] of Object.entries(rec)) if (!skip.has(k) && v !== null && v !== "") out[k] = v;
  return out;
}

export function normalizeRow(datasetId: string, kind: UploadKind, campaign: CampaignCode, rec: RawRecord): NormalizedRow {
  switch (kind) {
    case "base": {
      const m = BASE_MAP[datasetId] ?? { profile: "Perfil" };
      const niuKey = m.niu ?? "NIU";
      return { niu: String(rec[niuKey] ?? ""), profile: m.profile ? text(rec[m.profile]) : null, offer: m.offer ? text(rec[m.offer]) : null, extra: extraOf(rec, [niuKey, m.profile, m.offer]) };
    }
    case "sabana": {
      const m = SALE_MAP[campaign];
      return {
        niu: String(rec.NIU ?? ""),
        process: m.process ? text(rec[m.process]) : null,
        saleDate: toISODate(rec[m.date], m.dateDMY) || null,
        executive: text(rec[m.executive]),
        statusRaw: text(rec[m.status]),
        reason: m.reason ? text(rec[m.reason]) : null,
        daysInProcess: m.days ? intOrNull(rec[m.days]) : null,
        amount: m.amount ? numOrNull(rec[m.amount]) : null,
        extra: extraOf(rec, ["NIU", m.process, m.executive, m.status, m.reason, m.days, m.amount]),
      };
    }
    case "tipif":
      return {
        niu: String(rec.NIU ?? ""),
        agent: text(rec.Agente),
        calledAt: text(rec.Fecha),
        category: text(rec.Categoria),
        tipologia: text(rec.Tipologia),
        extra: extraOf(rec, ["NIU", "Agente", "Fecha", "Categoria", "Tipologia"]),
      };
    case "ventas":
      return {
        niu: String(rec.NIU ?? ""),
        agent: text(rec.Agente),
        enteredAt: text(rec.FechaHora) ?? text(rec.Fecha),
        product: text(rec.Producto),
        extra: extraOf(rec, ["NIU", "Agente", "FechaHora", "Fecha", "Producto"]),
      };
  }
}

/** Campos que nunca se muestran en la vista previa (información sensible). */
export const PREVIEW_HIDDEN: Record<string, string[]> = { "domi:sabana": ["Monto"] };
