/* Archivo de citas de entrega para el banco: el mismo formato del "VISITA_TDC" (hoja VISITA, encabezado
   rojo oscuro con letra blanca, Calibri 11, todo centrado, mismos anchos). Un archivo por FECHA GESTION. */
import { libroConEstilos, type ColumnaEstilo } from "@crm/core";
import type { CitaDocumentacion } from "./api";

const ENCABEZADO = { relleno: "980000", letra: "FFFFFF", alinear: "center" } as const;
const c = (titulo: string, ancho: number, extra: Partial<ColumnaEstilo> = {}): ColumnaEstilo => ({ titulo, ancho, ...ENCABEZADO, ...extra });

/** Citas agendadas ese día (FECHA GESTION = AAAA-MM-DD), en el orden en que se agendaron. */
export const citasDelDia = (citas: CitaDocumentacion[], dia: string) => citas.filter((x) => x.fechaGestion === dia).sort((a, b) => a.fecha - b.fecha || a.id - b.id);

export function descargarCitas(citas: CitaDocumentacion[], dia: string): void {
  const libro = libroConEstilos([
    {
      nombre: "VISITA",
      fuente: { nombre: "Calibri", tamano: 11 },
      columnas: [
        c("FECHA GESTION", 14.86, { tipo: "fecha" }),
        c("NIU", 14.14, { tipo: "numero" }),
        c("CLIENTE", 45),
        c("TELEFONO", 11.71, { tipo: "numero" }),
        c("DEPARTAMENTO", 14.71),
        c("LUGAR ENTREGA", 38.86),
        c("DIRECCION", 122.57),
        c("FECHA CITA", 15.71, { tipo: "fecha" }),
        c("HORA", 24.14),
        c("COMENTARIO", 151.43),
      ],
      filas: citasDelDia(citas, dia).map((x) => [x.fechaGestion, x.niu, x.cliente, x.telefono, x.departamento, x.lugarEntrega, x.direccion, x.fechaCita, x.hora, x.comentario]),
    },
  ]);
  const url = URL.createObjectURL(new Blob([libro as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `VISITA_TDC_${dia.slice(8, 10)}-${dia.slice(5, 7)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
