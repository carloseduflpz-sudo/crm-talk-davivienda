/* Seguimiento de documentación (TDC): cola de trabajo con los clientes de la sábana vigente en etapas de
   seguimiento y productivas, las llamadas de VICI después de la venta, y la gestión (STATUS homologado +
   comentario) que se registra aquí. Se descarga como el consolidado que se envía al banco. */
import { GRUPOS_DOCUMENTACION, STATUS_DOCUMENTACION, type GrupoDocumentacion } from "@crm/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Download, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Card, EmptyState, PageHeader } from "../components/ui";
import { api, type FilaDocumentacion, type SeguimientoDocumentacion as Datos } from "../lib/api";
import { descargarConsolidado, fechaDMY } from "../lib/consolidadoDoc";

const fmtInt = new Intl.NumberFormat("es-SV");
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "0.0%");
const fechaHora = (ms: number) =>
  new Date(ms).toLocaleString("es-SV", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const llamadaFecha = (iso: string | null) => (iso ? `${fechaDMY(iso)} ${iso.slice(11, 16)}`.trim() : "");

/** Un cliente de la cola: las filas de la sábana de la misma venta (doble TC) van juntas. */
interface Item {
  key: string;
  f: FilaDocumentacion;
  tarjetas: number;
  digitos: string;
}

function agrupar(filas: FilaDocumentacion[]): Item[] {
  const out = new Map<string, Item>();
  for (const f of filas) {
    const key = `${f.grupo}|${f.niu}|${f.venta ?? ""}`;
    const it = out.get(key);
    if (!it) out.set(key, { key, f, tarjetas: 1, digitos: f.digitos ?? "" });
    else {
      it.tarjetas++;
      if (f.digitos && !it.digitos.split(" / ").includes(f.digitos)) it.digitos = it.digitos ? `${it.digitos} / ${f.digitos}` : f.digitos;
    }
  }
  return [...out.values()];
}

const SIN_GESTION = "__sin_gestion";
const SIN_LLAMADAS = "__sin_llamadas";

export function SeguimientoDocumentacion() {
  const datos = useQuery({ queryKey: ["seguimiento-doc"], queryFn: api.seguimientoDocumentacion, staleTime: 30_000 });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000 });
  const puedeGestionar = Boolean(me.data?.permissions.includes("datos:cargar"));
  const [grupo, setGrupo] = useState<GrupoDocumentacion>("seguimiento");
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState("");

  const d = datos.data;
  const items = useMemo(() => agrupar(d?.filas ?? []), [d]);
  const delGrupo = (g: GrupoDocumentacion) => items.filter((i) => i.f.grupo === g);
  const lista = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return items.filter((i) => {
      if (i.f.grupo !== grupo) return false;
      if (filtro === SIN_GESTION && i.f.notas.length) return false;
      if (filtro === SIN_LLAMADAS && i.f.llamadas) return false;
      if (filtro && filtro !== SIN_GESTION && filtro !== SIN_LLAMADAS && i.f.notas[0]?.status !== filtro) return false;
      if (t && !`${i.f.niu} ${i.f.nombre ?? ""} ${i.f.telefono ?? ""}`.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [items, grupo, filtro, buscar]);

  const total = items.length;
  const conGestion = items.filter((i) => i.f.notas.length).length;
  const sinLlamadas = items.filter((i) => !i.f.llamadas).length;
  const actual = abierto ? (lista.find((i) => i.key === abierto) ?? items.find((i) => i.key === abierto) ?? null) : null;
  const siguiente = () => {
    const idx = lista.findIndex((i) => i.key === abierto);
    setAbierto(lista[idx + 1]?.key ?? null);
  };

  const descargar = async () => {
    if (!d) return;
    setBajando(true);
    setError("");
    try {
      await descargarConsolidado(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo preparar la descarga.");
    } finally {
      setBajando(false);
    }
  };

  const subtitulo = d?.sabana
    ? `TDC · sábana vigente ${d.sabana.archivo} · corte ${fechaDMY(d.sabana.corte)}`
    : "TDC · clientes de la sábana en etapas de seguimiento y productivas, con su gestión.";

  return (
    <>
      <PageHeader
        title="Seguimiento de documentación"
        subtitle={subtitulo}
        actions={
          d?.sabana ? (
            <button
              type="button"
              onClick={descargar}
              disabled={bajando || !d.filas.length}
              className="inline-flex items-center gap-2 rounded-full border border-hair px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-ink-faint disabled:opacity-50"
            >
              {bajando ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4 text-ink-soft" aria-hidden />}
              Descargar consolidado
            </button>
          ) : undefined
        }
      />
      {error && <p className="mb-4 text-[13px] text-[var(--st-critical)]">{error}</p>}
      {datos.isError && <p className="mb-4 text-sm text-[var(--st-critical)]">{datos.error.message}</p>}
      {datos.isPending && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Cargando">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-[20px] bg-paper dark:bg-slate-800" />
          ))}
        </div>
      )}
      {d && !d.sabana && (
        <EmptyState icon={ClipboardList} title="No hay sábana de TDC cargada">
          Carga la sábana de TDC en el Centro de carga.
        </EmptyState>
      )}
      {d?.sabana && (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {GRUPOS_DOCUMENTACION.map((g) => (
              <Kpi key={g.id} label={g.label} valor={delGrupo(g.id).length} pie={`${pct(delGrupo(g.id).length, total)} de ${fmtInt.format(total)} clientes`} />
            ))}
            <Kpi label="Con gestión" valor={conGestion} pie={`${pct(conGestion, total)} de ${fmtInt.format(total)} clientes`} />
            <Kpi label="Sin llamadas después de la venta" valor={sinLlamadas} pie={`${pct(sinLlamadas, total)} de ${fmtInt.format(total)} clientes`} />
          </div>

          <Card className="p-0!">
            <div className="flex flex-wrap items-center gap-3 border-b border-hair px-5 py-4">
              <div className="flex rounded-full border border-hair p-1" role="tablist">
                {GRUPOS_DOCUMENTACION.map((g) => (
                  <button
                    key={g.id}
                    role="tab"
                    aria-selected={grupo === g.id}
                    onClick={() => setGrupo(g.id)}
                    className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${grupo === g.id ? "bg-brand-500 text-white" : "text-ink-soft hover:text-ink"}`}
                  >
                    {g.label} <span className="tabular-nums opacity-80">{fmtInt.format(delGrupo(g.id).length)}</span>
                  </button>
                ))}
              </div>
              <label className="relative min-w-56 flex-1">
                <span className="sr-only">Buscar por NIU, nombre o teléfono</span>
                <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
                <input
                  value={buscar}
                  onChange={(e) => setBuscar(e.target.value)}
                  placeholder="Buscar NIU, nombre o teléfono"
                  className="w-full rounded-full border border-hair bg-paper py-2 pr-4 pl-10 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-brand-500 focus:bg-white dark:focus:bg-slate-900"
                />
              </label>
              <select
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                aria-label="Filtrar por STATUS"
                className="rounded-full border border-hair bg-white px-4 py-2 text-[13px] text-ink outline-none focus:border-brand-500 dark:bg-slate-900"
              >
                <option value="">Todos los STATUS</option>
                <option value={SIN_GESTION}>Sin gestión</option>
                <option value={SIN_LLAMADAS}>Sin llamadas después de la venta</option>
                {STATUS_DOCUMENTACION.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <Tabla grupo={grupo} lista={lista} onAbrir={setAbierto} />
          </Card>
        </>
      )}
      {actual && d && (
        <Gestion item={actual} puedeGestionar={puedeGestionar} onClose={() => setAbierto(null)} onSiguiente={siguiente} hayOtro={lista.findIndex((i) => i.key === abierto) < lista.length - 1} />
      )}
    </>
  );
}

function Kpi({ label, valor, pie }: { label: string; valor: number; pie: string }) {
  return (
    <Card>
      <p className="text-[12.5px] text-ink-soft">{label}</p>
      <p className="mt-1 text-[26px] leading-tight font-semibold text-ink tabular-nums">{fmtInt.format(valor)}</p>
      <p className="mt-1 text-[12px] text-ink-faint">{pie}</p>
    </Card>
  );
}

function Tabla({ grupo, lista, onAbrir }: { grupo: GrupoDocumentacion; lista: Item[]; onAbrir: (k: string) => void }) {
  if (!lista.length) return <p className="p-6 text-sm text-ink-soft">No hay clientes con este filtro.</p>;
  const cols: { label: string; cell: (i: Item) => string | number }[] = [
    { label: "NIU", cell: (i) => i.f.niu },
    { label: "Venta", cell: (i) => fechaDMY(i.f.venta) },
    { label: "Nombre", cell: (i) => i.f.nombre ?? "" },
    ...(grupo === "seguimiento"
      ? [{ label: "Pendiente por requisito", cell: (i: Item) => i.f.requisito ?? "" }]
      : [
          { label: "Dígitos", cell: (i: Item) => i.digitos },
          { label: "Detalle de la devolución", cell: (i: Item) => i.f.detalle ?? "" },
        ]),
    { label: "Subetapa", cell: (i) => i.f.subetapa ?? "" },
    { label: "STATUS", cell: (i) => i.f.notas[0]?.status ?? "" },
    { label: "Comentario", cell: (i) => i.f.notas[0]?.comentario ?? "" },
    { label: "Teléfono", cell: (i) => i.f.telefono ?? "" },
    { label: "Llamadas", cell: (i) => i.f.llamadas },
    { label: "Días de gestión", cell: (i) => i.f.dias },
    { label: "Tipificación", cell: (i) => i.f.tipificacion ?? "" },
  ];
  const num = (l: string) => l === "Llamadas" || l === "Días de gestión";
  return (
    <div className="overflow-auto">
      <table className="w-full text-[13px]">
        <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
          <tr className="text-[12px] text-ink-faint">
            {cols.map((c) => (
              <th key={c.label} className={`border-b border-hair px-3 py-3 font-normal whitespace-nowrap first:pl-5 last:pr-5 ${num(c.label) ? "text-right" : "text-left"}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lista.map((i) => (
            <tr
              key={i.key}
              tabIndex={0}
              onClick={() => onAbrir(i.key)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onAbrir(i.key))}
              className="cursor-pointer border-b border-hair outline-none last:border-0 hover:bg-paper/60 focus-visible:bg-paper dark:hover:bg-slate-800/40"
            >
              {cols.map((c, j) => {
                const v = c.cell(i);
                return (
                  <td
                    key={c.label}
                    className={`max-w-44 truncate px-3 py-2.5 whitespace-nowrap first:pl-5 last:pr-5 ${j === 0 ? "font-medium text-ink tabular-nums" : "text-ink/80"} ${num(c.label) ? "text-right tabular-nums" : ""}`}
                    title={String(v)}
                  >
                    {v === "" ? <span className="text-ink-faint">—</span> : v}
                    {j === 0 && i.tarjetas > 1 && <span className="ml-2 rounded-full bg-paper px-2 py-0.5 text-[11px] font-normal text-ink-soft">{i.tarjetas} TC</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Dato({ label, children }: { label: string; children: string | number | null | undefined }) {
  return (
    <div>
      <p className="text-[12px] text-ink-faint">{label}</p>
      <p className="mt-0.5 text-[13.5px] text-ink">{children === null || children === undefined || children === "" ? "—" : children}</p>
    </div>
  );
}

function Gestion({ item, puedeGestionar, onClose, onSiguiente, hayOtro }: { item: Item; puedeGestionar: boolean; onClose: () => void; onSiguiente: () => void; hayOtro: boolean }) {
  const qc = useQueryClient();
  const f = item.f;
  const [status, setStatus] = useState("");
  const [comentario, setComentario] = useState("");
  const siguienteRef = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setStatus("");
    setComentario("");
  }, [item.key]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const guardar = useMutation({
    mutationFn: () => api.gestionDocumentacion({ niu: f.niu, venta: f.venta ?? "", status, comentario }),
    onSuccess: (nota) => {
      // La gestión queda al frente de la venta y del historial, sin volver a pedir toda la cola.
      qc.setQueryData<Datos>(["seguimiento-doc"], (old) =>
        old && {
          ...old,
          filas: old.filas.map((x) => (x.niu === f.niu && (x.venta ?? "") === nota.venta ? { ...x, notas: [nota, ...x.notas] } : x)),
          historial: [{ ...nota, nombre: f.nombre, subetapa: f.subetapa }, ...old.historial],
        },
      );
      setStatus("");
      setComentario("");
      if (siguienteRef.current) onSiguiente();
    },
  });
  const submit = (e: FormEvent, siguiente: boolean) => {
    e.preventDefault();
    if (!status) return;
    siguienteRef.current = siguiente;
    guardar.mutate();
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="gestion-titulo">
      <div className="fade-in absolute inset-0 bg-[#0e1b3d]/20 backdrop-blur-[2px] dark:bg-black/50" onClick={onClose} aria-hidden />
      <div className="drawer-in absolute inset-y-0 right-0 flex w-full max-w-[640px] flex-col border-l border-hair bg-white shadow-[-24px_0_48px_rgba(14,27,61,0.10)] dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-hair px-6 pt-6 pb-5">
          <div className="min-w-0">
            <p className="text-[12.5px] text-ink-soft">
              {GRUPOS_DOCUMENTACION.find((g) => g.id === f.grupo)?.label} · NIU {f.niu}
              {item.tarjetas > 1 && ` · ${item.tarjetas} TC`}
            </p>
            <h2 id="gestion-titulo" className="mt-1 text-[20px] leading-tight font-semibold tracking-[-0.01em] text-ink">
              {f.nombre ?? `NIU ${f.niu}`}
            </h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="-mr-2 rounded-full p-2 text-ink-soft transition-colors hover:bg-paper hover:text-ink dark:hover:bg-slate-800" aria-label="Cerrar">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Dato label="Venta">{fechaDMY(f.venta)}</Dato>
            <Dato label="Subetapa">{f.subetapa}</Dato>
            <Dato label="Etapa primaria">{f.etapa}</Dato>
            {f.grupo === "seguimiento" ? <Dato label="Pendiente por requisito">{f.requisito}</Dato> : <Dato label="Dígitos">{item.digitos}</Dato>}
            <Dato label="Teléfono">{f.telefono}</Dato>
            <Dato label="Ejecutivo">{f.ejecutivo}</Dato>
            <Dato label="Llamadas">{f.llamadas}</Dato>
            <Dato label="Días de gestión">{f.dias}</Dato>
            <Dato label="Última llamada">{f.ultimaLlamada ? `${llamadaFecha(f.ultimaLlamada)} · ${f.tipificacion ?? "Sin tipificar"}` : null}</Dato>
          </div>
          {f.detalle && (
            <div className="mt-4">
              <Dato label="Detalle de la devolución">{f.detalle}</Dato>
            </div>
          )}
          {f.motivo && (
            <div className="mt-4">
              <Dato label="Motivo devolución / observaciones extrarrequisito / comentario general">{f.motivo}</Dato>
            </div>
          )}

          {puedeGestionar && (
            <form onSubmit={(e) => submit(e, false)} className="mt-6 rounded-2xl border border-hair p-4">
              <p className="text-[13px] font-medium text-ink">Registrar gestión</p>
              <label className="mt-3 block">
                <span className="text-[12px] text-ink-faint">STATUS</span>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  required
                  className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900"
                >
                  <option value="">Elige el STATUS</option>
                  {STATUS_DOCUMENTACION.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mt-3 block">
                <span className="text-[12px] text-ink-faint">Comentario</span>
                <textarea
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  maxLength={1000}
                  rows={3}
                  className="mt-1 w-full resize-y rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 dark:border-slate-700 dark:bg-slate-900"
                />
              </label>
              {guardar.isError && <p className="mt-2 text-[13px] text-[var(--st-critical)]">{guardar.error.message}</p>}
              <div className="mt-3 flex flex-wrap justify-end gap-2">
                <button
                  type="submit"
                  disabled={!status || guardar.isPending}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={(e) => submit(e, true)}
                  disabled={!status || guardar.isPending || !hayOtro}
                  className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                >
                  {guardar.isPending ? "Guardando…" : "Guardar y siguiente"}
                </button>
              </div>
            </form>
          )}

          <p className="mt-6 text-[13px] font-medium text-ink">Historial de gestión</p>
          {f.notas.length ? (
            <ol className="mt-2 divide-y divide-hair rounded-2xl border border-hair">
              {f.notas.map((n) => (
                <li key={n.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink">{n.status}</span>
                    <span className="text-[12px] text-ink-faint">
                      {fechaHora(n.fecha)} · {n.por}
                    </span>
                  </div>
                  {n.comentario && <p className="mt-1 text-[13px] text-ink/80">{n.comentario}</p>}
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-[13px] text-ink-soft">Sin gestión registrada.</p>
          )}
        </div>
      </div>
    </div>
  );
}
