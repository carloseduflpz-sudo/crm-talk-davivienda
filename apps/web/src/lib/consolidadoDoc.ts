/* Consolidado de seguimiento de documentación para el banco: las mismas hojas y columnas del
   "SEGUIMIENTO DE SABANA TC", más LLAMADAS y DÍAS DE GESTIÓN, y el historial de gestión del CRM. */
import type { FilaDocumentacion, SeguimientoDocumentacion } from "./api";
import { downloadWorkbook } from "./export";

/** 2026-11-18 → 18/11/2026 (como viene la VENTA en el consolidado). */
export const fechaDMY = (iso: string | null | undefined) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : (iso ?? ""));
const fechaHora = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const MESES = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];

function comun(f: FilaDocumentacion) {
  const u = f.notas[0];
  return {
    niu: f.niu,
    venta: fechaDMY(f.venta),
    nombre: f.nombre ?? "",
    subetapa: f.subetapa ?? "",
    status: u?.status ?? "",
    comentario: u?.comentario ?? "",
    telefono: f.telefono ?? "",
    llamadas: f.llamadas,
    dias: f.dias,
    tipologias: f.tipificacion ?? "",
  };
}

const COLS_FIN = [
  { key: "subetapa", label: "SUBETAPA" },
  { key: "status", label: "STATUS" },
  { key: "comentario", label: "COMENTARIO" },
  { key: "telefono", label: "TELEFONO" },
  { key: "llamadas", label: "LLAMADAS" },
  { key: "dias", label: "DÍAS DE GESTIÓN" },
  { key: "tipologias", label: "TIPOLOGIAS" },
];
const COLS_INICIO = [
  { key: "niu", label: "NIU" },
  { key: "venta", label: "VENTA" },
  { key: "nombre", label: "NOMBRE" },
];

export async function descargarConsolidado(d: SeguimientoDocumentacion): Promise<void> {
  const seguimiento = d.filas.filter((f) => f.grupo === "seguimiento");
  const productivas = d.filas.filter((f) => f.grupo === "productivas");
  const hoy = new Date();
  await downloadWorkbook(`SEGUIMIENTO DE SABANA TC ${hoy.getDate()} ${MESES[hoy.getMonth()]}.xlsx`, [
    {
      name: "ETAPAS EN SEGUIMIENTO",
      columns: [...COLS_INICIO, { key: "requisito", label: "PENDIENTE POR REQUISITO" }, ...COLS_FIN],
      rows: seguimiento.map((f) => ({ ...comun(f), requisito: f.requisito ?? "" })),
    },
    {
      name: "ETAPAS PRODUCTIVAS",
      columns: [...COLS_INICIO, { key: "digitos", label: "DIGITOS" }, { key: "detalle", label: "DETALLE DE LA DEVOLUCIÓN" }, ...COLS_FIN],
      rows: productivas.map((f) => ({ ...comun(f), digitos: f.digitos ?? "", detalle: f.detalle ?? "" })),
    },
    {
      name: "HISTORIAL DE GESTIÓN",
      columns: [
        { key: "fecha", label: "FECHA DE GESTIÓN" },
        { key: "por", label: "USUARIO" },
        { key: "niu", label: "NIU" },
        { key: "venta", label: "VENTA" },
        { key: "nombre", label: "NOMBRE" },
        { key: "subetapa", label: "SUBETAPA EN SÁBANA" },
        { key: "status", label: "STATUS" },
        { key: "comentario", label: "COMENTARIO" },
      ],
      rows: d.historial.map((n) => ({ ...n, fecha: fechaHora(n.fecha), venta: fechaDMY(n.venta), nombre: n.nombre ?? "", subetapa: n.subetapa ?? "", comentario: n.comentario ?? "" })),
    },
  ]);
}
