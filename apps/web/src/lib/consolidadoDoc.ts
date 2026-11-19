/* Consolidado de seguimiento de documentación para el banco: el mismo formato del "SEGUIMIENTO DE SABANA TC"
   (hojas, columnas, colores, letra y anchos), más LLAMADAS y DÍAS DE GESTIÓN, y el historial de gestión del CRM. */
import { libroConEstilos, type ColumnaEstilo, type HojaEstilo } from "@crm/core";
import type { FilaDocumentacion, SeguimientoDocumentacion } from "./api";

/** 2026-11-18 → 18/11/2026 (como viene la VENTA en el consolidado). */
export const fechaDMY = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : (iso ?? ""));
const fechaHora = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

/* Colores del consolidado: rojo con letra blanca = datos de la sábana; amarillo = gestión de Talk. */
const ROJO = { relleno: "C00000", letra: "FFFFFF", negrita: true } as const;
const AMARILLO = { relleno: "FFFF00" } as const;
const c = (titulo: string, ancho: number, estilo: Partial<ColumnaEstilo>, extra: Partial<ColumnaEstilo> = {}): ColumnaEstilo => ({ titulo, ancho, relleno: "", ...estilo, ...extra });

const ultima = (f: FilaDocumentacion) => f.notas[0];

function hojaSeguimiento(filas: FilaDocumentacion[]): HojaEstilo {
  const am = { ...AMARILLO, negrita: true };
  return {
    nombre: "ETAPAS EN SEGUIMIENTO",
    fuente: { nombre: "Calibri Light", tamano: 12 },
    zoom: 85,
    columnas: [
      c("NIU", 13.5, ROJO, { tipo: "numero" }),
      c("VENTA", 12.3, ROJO, { tipo: "fecha" }),
      c("NOMBRE", 47.8, ROJO),
      c("PENDIENTE POR REQUISITO", 55.3, ROJO),
      c("SUBETAPA", 28.5, ROJO),
      c("STATUS", 20.5, am),
      c("COMENTARIO", 173.5, am),
      c("TELEFONO", 27.8, am, { tipo: "numero" }),
      c("LLAMADAS", 12, am, { tipo: "numero", alinear: "center" }),
      c("DÍAS DE GESTIÓN", 18, am, { tipo: "numero", alinear: "center" }),
      c("TIPOLOGIAS", 16.5, AMARILLO, { tamano: 8 }),
    ],
    filas: filas.map((f) => [f.niu, f.venta, f.nombre, f.requisito, f.subetapa, ultima(f)?.status, ultima(f)?.comentario, f.telefono, f.llamadas, f.dias, f.tipificacion]),
  };
}

function hojaProductivas(filas: FilaDocumentacion[]): HojaEstilo {
  return {
    nombre: "ETAPAS PRODUCTIVAS",
    fuente: { nombre: "Calibri Light", tamano: 11 },
    columnas: [
      c("NIU", 11.3, ROJO, { tipo: "numero" }),
      c("VENTA", 11.5, ROJO, { tipo: "fecha" }),
      c("NOMBRE", 37.5, ROJO),
      c("DIGITOS", 9.5, ROJO, { alinear: "center" }),
      c("EN DISTRIBUCION", 78, ROJO),
      c("SUBETAPA", 26, ROJO),
      c("STATUS", 18.5, AMARILLO),
      c("COMENTARIO", 73.2, AMARILLO),
      c("TELEFONO", 11.8, AMARILLO, { tipo: "numero" }),
      c("LLAMADAS", 12, AMARILLO, { tipo: "numero", alinear: "center" }),
      c("DÍAS DE GESTIÓN", 18, AMARILLO, { tipo: "numero", alinear: "center" }),
      c("TIPOLOGIAS", 12.5, AMARILLO, { tamano: 8 }),
    ],
    filas: filas.map((f) => [f.niu, f.venta, f.nombre, f.digitos, f.detalle, f.subetapa, ultima(f)?.status, ultima(f)?.comentario, f.telefono, f.llamadas, f.dias, f.tipificacion]),
  };
}

export async function descargarConsolidado(d: SeguimientoDocumentacion): Promise<void> {
  const hoy = new Date();
  const libro = libroConEstilos([
    hojaSeguimiento(d.filas.filter((f) => f.grupo === "seguimiento")),
    hojaProductivas(d.filas.filter((f) => f.grupo === "productivas")),
    {
      nombre: "HISTORIAL DE GESTIÓN",
      fuente: { nombre: "Calibri Light", tamano: 11 },
      columnas: [
        c("FECHA DE GESTIÓN", 18, ROJO),
        c("USUARIO", 18, ROJO),
        c("NIU", 12, ROJO, { tipo: "numero" }),
        c("VENTA", 12, ROJO, { tipo: "fecha" }),
        c("NOMBRE", 40, ROJO),
        c("SUBETAPA EN SÁBANA", 28, ROJO),
        c("STATUS", 20, AMARILLO, { negrita: true }),
        c("COMENTARIO", 80, AMARILLO, { negrita: true }),
      ],
      filas: d.historial.map((n) => [fechaHora(n.fecha), n.por, n.niu, n.venta, n.nombre, n.subetapa, n.status, n.comentario]),
    },
  ]);
  const url = URL.createObjectURL(new Blob([libro as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `SEGUIMIENTO DE SABANA TC ${hoy.getDate()} ${MESES[hoy.getMonth()]}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
