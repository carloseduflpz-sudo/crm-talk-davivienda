/* Seguimiento de documentación (TDC): qué ventas de la sábana entran a la cola de trabajo, el STATUS
   homologado de la gestión y las llamadas de VICI hechas después de la venta. */
import { matchKey } from "./text";

/** Grupo del consolidado que se envía al banco. */
export type GrupoDocumentacion = "seguimiento" | "productivas";

export const GRUPOS_DOCUMENTACION: { id: GrupoDocumentacion; label: string; hoja: string }[] = [
  { id: "seguimiento", label: "Etapas en seguimiento", hoja: "ETAPAS EN SEGUIMIENTO" },
  { id: "productivas", label: "Etapas productivas", hoja: "ETAPAS PRODUCTIVAS" },
];

/** STATUS homologado de la gestión (los mismos del consolidado que se envía al banco). */
export const STATUS_DOCUMENTACION = [
  "NO CONTESTA",
  "BUZON DE VOZ",
  "VOLVER A LLAMAR",
  "SE REALIZA CITA",
  "PROMESA DE ENVIO",
  "RECUPERADO",
  "DESISTE TRAMITE",
  "ENTREGADA",
] as const;
export type StatusDocumentacion = (typeof STATUS_DOCUMENTACION)[number];

export const esStatusDocumentacion = (v: unknown): v is StatusDocumentacion =>
  typeof v === "string" && (STATUS_DOCUMENTACION as readonly string[]).includes(v);

/**
 * Grupo según la SUBETAPA de la sábana TDC:
 * - Etapas en seguimiento: pendiente por requisito, pendiente documento y extrarrequisito.
 *   Los vencidos (PENDIENTE DOCUMENTO/VENCIDO, …/VENCIDOS) no aplican.
 * - Etapas productivas: en proceso, en distribución y devolución.
 * Cualquier otra subetapa no entra a la cola.
 */
export function grupoDocumentacion(subetapa: unknown): GrupoDocumentacion | null {
  const s = matchKey(subetapa).replace(/\s*\/\s*/g, "/");
  if (!s || s.includes("VENCID")) return null;
  if (s.startsWith("PENDIENTE POR REQUISITO") || s.startsWith("PENDIENTE DOCUMENT") || s.startsWith("PENDIENTE POR DOCUMENT")) return "seguimiento";
  if (/^EXTRA ?R?REQUISITO/.test(s)) return "seguimiento";
  if (s === "EN PROCESO" || s.startsWith("EN DISTRIBU") || s.startsWith("DEVOLUCION")) return "productivas";
  return null;
}

export interface ToquesDocumentacion {
  /** Llamadas de VICI a ese NIU después del día de la venta. */
  llamadas: number;
  /** Días distintos en que se le llamó (3 llamadas el mismo día = 1 día de gestión). */
  dias: number;
  /** Fecha y hora de la última llamada. */
  ultima: string | null;
  /** Tipificación de la última llamada. */
  tipificacion: string | null;
}

/**
 * Cuenta las llamadas hechas desde el día siguiente a la venta (venta del 18-11 → desde el 19-11).
 * Sin fecha de venta se cuentan todas.
 */
export function toquesDespuesDeVenta(venta: string | null, llamadas: { fecha: string | null; tipologia: string | null }[]): ToquesDocumentacion {
  const dia = venta ? venta.slice(0, 10) : "";
  const validas = llamadas.filter((c) => c.fecha && c.fecha.slice(0, 10) > dia).sort((a, b) => a.fecha!.localeCompare(b.fecha!));
  const ultima = validas[validas.length - 1] ?? null;
  return {
    llamadas: validas.length,
    dias: new Set(validas.map((c) => c.fecha!.slice(0, 10))).size,
    ultima: ultima?.fecha ?? null,
    tipificacion: ultima?.tipologia?.trim() || null,
  };
}

/* ===== Citas de entrega (archivo VISITA TDC) ===== */

/** Departamentos de El Salvador, como van en el archivo de visita. */
export const DEPARTAMENTOS_SV = [
  "AHUACHAPAN",
  "SANTA ANA",
  "SONSONATE",
  "CHALATENANGO",
  "LA LIBERTAD",
  "SAN SALVADOR",
  "CUSCATLAN",
  "LA PAZ",
  "CABAÑAS",
  "SAN VICENTE",
  "USULUTAN",
  "SAN MIGUEL",
  "MORAZAN",
  "LA UNION",
] as const;

/** Lugar de entrega; en el archivo va con el departamento: RESIDENCIA/CUSCATLAN. */
export const LUGARES_ENTREGA = ["RESIDENCIA", "TRABAJO", "AGENCIA"] as const;

/** Horario de la cita. */
export const HORARIOS_CITA = ["AM", "PM", "AM O PM"] as const;

/** Departamento de la sábana ("CUSCATLÁN", "San Salvador") → el de la lista, o null. */
export function departamentoSV(v: unknown): (typeof DEPARTAMENTOS_SV)[number] | null {
  const s = matchKey(v);
  if (!s) return null;
  return DEPARTAMENTOS_SV.find((d) => matchKey(d) === s) ?? null;
}

/** "RESIDENCIA" + "CUSCATLAN" → "RESIDENCIA/CUSCATLAN". */
export const lugarEntregaCita = (lugar: string, departamento: string) => `${lugar}/${departamento}`;
