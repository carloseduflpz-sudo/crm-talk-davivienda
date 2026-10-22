/* Las 6 campañas Davivienda y todo lo que las diferencia.
   Regla de la versión 2: la lógica es una sola; lo que cambia entre campañas vive aquí,
   como configuración. Los valores salen de la versión 1 (upload.js, importers.js, app.js). */

export const CAMPAIGN_CODES = ["tdc", "extrafin", "cdc", "upin", "seguros", "domi"] as const;
export type CampaignCode = (typeof CAMPAIGN_CODES)[number];

/** Tipos de archivo que se cargan cada mes. */
export type UploadKind = "sabana" | "base" | "tipif" | "ventas";

export interface DatasetDef {
  /** Identificador estable, p. ej. "tdc:base:primeras". */
  id: string;
  kind: UploadKind;
  label: string;
  /** De dónde sale el archivo, para orientar a quien carga. */
  source: string;
}

export interface CampaignDef {
  code: CampaignCode;
  name: string;
  shortName: string;
  /** Columna de la sábana del banco que trae el estatus de cada venta. */
  statusField: string;
  /** Estatus del banco que cuentan como venta aprobada. */
  approved: readonly string[];
  /** Estatus del banco que cuentan como rechazo. */
  rejected: readonly string[];
  /** Subprocesos que la sábana separa en hojas distintas, si los hay. */
  processes?: readonly string[];
  datasets: readonly DatasetDef[];
}

const tipif = (code: CampaignCode): DatasetDef => ({ id: `${code}:tipif`, kind: "tipif", label: "Tipificaciones", source: "Llamadas VICI" });
const ventasCrm = (code: CampaignCode, source = "Exportación del CRM"): DatasetDef => ({ id: `${code}:ventas`, kind: "ventas", label: "Ventas (CRM TALK)", source });

export const CAMPAIGNS: readonly CampaignDef[] = [
  {
    code: "tdc",
    name: "TDC · Tarjeta de Crédito",
    shortName: "TDC",
    statusField: "SUBETAPA",
    approved: ["ENTREGADA", "APROBADA"],
    rejected: ["RECHAZADA"],
    datasets: [
      { id: "tdc:sabana", kind: "sabana", label: "Sábana", source: "Consolidado de ventas (Reporte TDC TALK General)" },
      { id: "tdc:base:primeras", kind: "base", label: "Base Primeras Cuentas", source: "Base BAU · Tarjeta nueva" },
      { id: "tdc:base:segundas", kind: "base", label: "Base Segundas Cuentas", source: "Base 2a TDC" },
      tipif("tdc"),
      ventasCrm("tdc", "Ventas Davivienda TC"),
    ],
  },
  {
    code: "extrafin",
    name: "Extrafinanciamiento",
    shortName: "Extrafin",
    statusField: "Etapa",
    approved: ["ENTREGADA", "DESEMBOLSADO"],
    rejected: ["DEVOLUCION", "NO DESEMBOLSADO"],
    processes: ["BASE", "ONLINE"],
    datasets: [
      { id: "extrafin:sabana", kind: "sabana", label: "Sábana", source: "Reporte de Extrafinanciamiento (Base + Extra Online)" },
      { id: "extrafin:base", kind: "base", label: "Base", source: "Base Extrafinanciamiento" },
      tipif("extrafin"),
      ventasCrm("extrafin"),
    ],
  },
  {
    code: "cdc",
    name: "Compra de Cartera",
    shortName: "CDC",
    statusField: "Status",
    approved: ["APLICADA"],
    rejected: ["NO APLICA", "NO DESEMBOLSADO"],
    datasets: [
      { id: "cdc:sabana", kind: "sabana", label: "Sábana", source: "Reporte de CDC (hoja BASE)" },
      { id: "cdc:base:cdc", kind: "base", label: "Base CDC", source: "Base Compra de Cartera" },
      { id: "cdc:base:bienvenida", kind: "base", label: "Base Bienvenida", source: "Bienvenida" },
      tipif("cdc"),
      ventasCrm("cdc"),
    ],
  },
  {
    code: "upin",
    name: "UPIN · Upgrades e Incrementos",
    shortName: "UPIN",
    statusField: "Status",
    approved: ["APLICADO", "APROBADO"],
    rejected: ["DEVOLUCION", "RECHAZADO"],
    processes: ["INCREMENTO", "UPGRADE"],
    datasets: [
      { id: "upin:sabana", kind: "sabana", label: "Sábana", source: "Reporte de UPIN (Incrementos + Upgrades)" },
      { id: "upin:base", kind: "base", label: "Base", source: "Base Upgrade e Incrementos" },
      tipif("upin"),
      ventasCrm("upin"),
    ],
  },
  {
    code: "seguros",
    name: "Seguros · Todo Protegido",
    shortName: "Seguros",
    statusField: "Status",
    approved: ["ACTIVO"],
    rejected: ["CANCELADO POR SOLICITUD", "EN MORA"],
    datasets: [
      { id: "seguros:sabana", kind: "sabana", label: "Sábana", source: "Reporte de Seguros (hoja BASE)" },
      { id: "seguros:base", kind: "base", label: "Base", source: "Base Compras y Retiros Protegidos" },
      tipif("seguros"),
      ventasCrm("seguros"),
    ],
  },
  {
    code: "domi",
    name: "Domiciliaciones",
    shortName: "DOMI",
    statusField: "Status",
    approved: ["EXITOSA"],
    rejected: ["FALLIDA"],
    datasets: [
      { id: "domi:sabana", kind: "sabana", label: "Sábana", source: "Reporte de Domiciliaciones (hoja TALK AMERICAS)" },
      { id: "domi:base:domi", kind: "base", label: "Base Domiciliaciones", source: "Base Domiciliaciones" },
      { id: "domi:base:piloto", kind: "base", label: "Base Piloto", source: "Complementarios TALK · mes vencido" },
      tipif("domi"),
      ventasCrm("domi"),
    ],
  },
];

const BY_CODE = new Map(CAMPAIGNS.map((c) => [c.code, c]));

export function isCampaignCode(value: string): value is CampaignCode {
  return BY_CODE.has(value as CampaignCode);
}

export function getCampaign(code: CampaignCode): CampaignDef {
  const c = BY_CODE.get(code);
  if (!c) throw new Error(`Campaña desconocida: ${code}`);
  return c;
}

/** Todos los conjuntos de datos de todas las campañas, en orden. */
export const ALL_DATASETS: readonly (DatasetDef & { campaign: CampaignCode })[] = CAMPAIGNS.flatMap((c) =>
  c.datasets.map((d) => ({ ...d, campaign: c.code })),
);
