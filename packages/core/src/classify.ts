/* Clasificación única de estatus del banco y de tipologías de llamada.
   Toda pantalla, reporte y presentación usa estas funciones: una sola definición por cifra. */
import { getCampaign, type CampaignCode } from "./campaigns";
import { matchKey } from "./text";

export type SaleClass = "aprobado" | "rechazado" | "en_proceso";
export type CallClass = "venta" | "negativo" | "no_efectivo" | "no_contacto" | "sin_tipificar";

export const CALL_CLASSES: readonly CallClass[] = ["venta", "negativo", "no_efectivo", "no_contacto", "sin_tipificar"];

/** Clase de una venta según el estatus que reporta el banco en la sábana. */
export function classifySale(campaign: CampaignCode, rawStatus: unknown): SaleClass {
  const c = getCampaign(campaign);
  const key = matchKey(rawStatus);
  if (!key) return "en_proceso";
  if (c.approved.some((s) => matchKey(s) === key)) return "aprobado";
  if (c.rejected.some((s) => matchKey(s) === key)) return "rechazado";
  return "en_proceso";
}

/** Categoría general que trae VICI, usada cuando la tipología no está homologada. */
const CATEGORY_FALLBACK: Record<string, CallClass> = {
  "CONTACTO EFECTIVO POSITIVO": "venta",
  "CONTACTO EFECTIVO NEGATIVO": "negativo",
  "CONTACTO NO EFECTIVO": "no_efectivo",
  "NO CONTACTO": "no_contacto",
  "SIN TIPIFICAR": "sin_tipificar",
  "SIN ASIGNAR A UN AGENTE": "sin_tipificar",
};

/** Índice campaña → tipología normalizada → clase. Se arma con las filas de tipologia_map. */
export type TipologiaIndex = Map<CampaignCode, Map<string, CallClass>>;

export function buildTipologiaIndex(rows: Iterable<readonly [CampaignCode, string, CallClass]>): TipologiaIndex {
  const idx: TipologiaIndex = new Map();
  for (const [campaign, tipologia, cls] of rows) {
    let m = idx.get(campaign);
    if (!m) idx.set(campaign, (m = new Map()));
    m.set(matchKey(tipologia), cls);
  }
  return idx;
}

/**
 * Clase de una llamada: primero la tipología homologada de la campaña;
 * si no está, la categoría general de VICI; si tampoco, "sin_tipificar".
 */
export function classifyCall(index: TipologiaIndex, campaign: CampaignCode, tipologia: unknown, categoria: unknown): CallClass {
  const hit = index.get(campaign)?.get(matchKey(tipologia));
  if (hit) return hit;
  return CATEGORY_FALLBACK[matchKey(categoria)] ?? "sin_tipificar";
}

/**
 * ¿La llamada es contacto efectivo?
 * PENDIENTE DE CONFIRMAR CON CARLOS: la versión 1 tenía dos reglas distintas.
 *  - Contactabilidad general: venta + negativo + no_efectivo.
 *  - isContactoEfectivo:      venta + negativo.
 * Mientras se confirma, la regla vive en un solo lugar y es configurable.
 */
export type ContactRule = "con_no_efectivo" | "sin_no_efectivo";
export function isEffectiveContact(cls: CallClass, rule: ContactRule): boolean {
  if (cls === "venta" || cls === "negativo") return true;
  return rule === "con_no_efectivo" && cls === "no_efectivo";
}
