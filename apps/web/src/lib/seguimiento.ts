/* Descarga del seguimiento de uno o varios clientes: todo lo de su ficha en un Excel con una hoja por tema
   (clientes, ventas, bases, llamadas y CRM), con todas las columnas que traen los archivos. */
import { getCampaign, isCampaignCode, type CampaignCode } from "@crm/core";
import type { ClientFile } from "./api";
import { downloadWorkbook } from "./export";

const campana = (c: string) => (isCampaignCode(c) ? getCampaign(c as CampaignCode).shortName : c);
const base = (c: string, id: string) => (isCampaignCode(c) ? (getCampaign(c as CampaignCode).datasets.find((d) => d.id === id)?.label ?? id) : id);
const CLASE_VENTA: Record<string, string> = { aprobado: "Aprobada", rechazado: "Rechazada", en_proceso: "En proceso" };
const CLASE_LLAMADA: Record<string, string> = { venta: "Venta", negativo: "Contacto negativo", no_efectivo: "Contacto no efectivo", no_contacto: "No contacto", sin_tipificar: "Sin tipificar" };

type Col = { key: string; label: string };
type Fila = Record<string, unknown>;

/** Columnas fijas más todas las del archivo (las que se repiten con una fija llevan "(archivo)"). */
function conExtras(fijas: Col[], filas: { extra?: Record<string, unknown> }[]): Col[] {
  const llaves: string[] = [];
  for (const f of filas) for (const k of Object.keys(f.extra ?? {})) if (!llaves.includes(k)) llaves.push(k);
  const usadas = new Set(fijas.map((c) => c.label.toLowerCase()));
  return [...fijas, ...llaves.map((k) => ({ key: `x:${k}`, label: usadas.has(k.toLowerCase()) ? `${k} (archivo)` : k }))];
}
const extras = (e: Record<string, unknown> | undefined): Fila => Object.fromEntries(Object.entries(e ?? {}).map(([k, v]) => [`x:${k}`, v]));

export async function descargarSeguimiento(fichas: ClientFile[], nombre: string): Promise<void> {
  const quien = (f: ClientFile) => ({ niu: f.niu, nombre: f.contacto.nombre ?? "" });
  const clientes = fichas.map((f) => ({
    ...quien(f),
    dui: f.contacto.dui ?? "",
    telefonos: f.contacto.telefonos.join(" / "),
    correo: f.contacto.correo ?? "",
    municipio: f.contacto.municipio ?? "",
    departamento: f.contacto.departamento ?? "",
    campanas: f.campanas.map((c) => campana(c.campaign)).join(", "),
  }));
  const ventas = fichas.flatMap((f) =>
    f.campanas.flatMap((c) =>
      c.ventas.map((v) => ({
        ...quien(f),
        campana: campana(c.campaign),
        mes: v.month,
        fecha: v.fecha ?? "",
        agente: v.agente,
        estatus: v.estatus ?? "",
        resultado: CLASE_VENTA[v.clase] ?? v.clase,
        motivo: v.motivo ?? "",
        monto: v.monto ?? "",
        proceso: v.proceso ?? "",
        dias: v.dias ?? "",
        extra: v.extra,
        ...extras(v.extra),
      })),
    ),
  );
  const bases = fichas.flatMap((f) =>
    f.campanas.flatMap((c) =>
      c.bases.map((b) => ({
        ...quien(f),
        campana: campana(c.campaign),
        mes: b.month,
        base: b.adicional ? `${base(c.campaign, b.dataset)} · ${b.nombreBase ?? "adicional"}` : base(c.campaign, b.dataset),
        perfil: b.perfil ?? "",
        oferta: b.oferta ?? "",
        extra: b.extra,
        ...extras(b.extra),
      })),
    ),
  );
  const llamadas = fichas.flatMap((f) =>
    f.campanas.flatMap((c) =>
      c.llamadas.map((l) => ({ ...quien(f), campana: campana(c.campaign), mes: l.month, fecha: l.fecha ?? "", agente: l.agente, categoria: l.categoria ?? "", tipologia: l.tipologia ?? "", resultado: CLASE_LLAMADA[l.clase] ?? l.clase })),
    ),
  );
  const crm = fichas.flatMap((f) =>
    f.campanas.flatMap((c) => c.crm.map((x) => ({ ...quien(f), campana: campana(c.campaign), mes: x.month, fecha: x.fecha ?? "", agente: x.agente, producto: x.producto ?? "", extra: x.extra, ...extras(x.extra) }))),
  );
  const id: Col[] = [
    { key: "niu", label: "NIU" },
    { key: "nombre", label: "Nombre" },
    { key: "campana", label: "Campaña" },
  ];
  await downloadWorkbook(nombre, [
    {
      name: "Clientes",
      columns: [
        { key: "niu", label: "NIU" },
        { key: "nombre", label: "Nombre" },
        { key: "dui", label: "DUI" },
        { key: "telefonos", label: "Teléfonos" },
        { key: "correo", label: "Correo" },
        { key: "municipio", label: "Municipio" },
        { key: "departamento", label: "Departamento" },
        { key: "campanas", label: "Campañas" },
      ],
      rows: clientes,
    },
    {
      name: "Ventas (sábana)",
      columns: conExtras(
        [
          ...id,
          { key: "mes", label: "Mes de la sábana" },
          { key: "fecha", label: "Fecha de venta" },
          { key: "agente", label: "Agente" },
          { key: "estatus", label: "Estatus" },
          { key: "resultado", label: "Resultado" },
          { key: "motivo", label: "Motivo" },
          { key: "monto", label: "Monto" },
          { key: "proceso", label: "Proceso" },
          { key: "dias", label: "Días en proceso" },
        ],
        ventas,
      ),
      rows: ventas,
    },
    {
      name: "Bases",
      columns: conExtras(
        [...id, { key: "mes", label: "Mes" }, { key: "base", label: "Base" }, { key: "perfil", label: "Perfil" }, { key: "oferta", label: "Oferta" }],
        bases,
      ),
      rows: bases,
    },
    {
      name: "Llamadas",
      columns: [
        ...id,
        { key: "mes", label: "Mes" },
        { key: "fecha", label: "Fecha y hora" },
        { key: "agente", label: "Agente" },
        { key: "categoria", label: "Categoría" },
        { key: "tipologia", label: "Tipología" },
        { key: "resultado", label: "Resultado" },
      ],
      rows: llamadas,
    },
    {
      name: "CRM",
      columns: conExtras([...id, { key: "mes", label: "Mes" }, { key: "fecha", label: "Fecha" }, { key: "agente", label: "Agente" }, { key: "producto", label: "Producto" }], crm),
      rows: crm,
    },
  ]);
}
