/* Seguimiento de documentación (TDC): cola de trabajo con los clientes de la sábana vigente en etapas de
   seguimiento y productivas, las llamadas de VICI después de la venta, y la gestión (STATUS homologado +
   comentario) que se registra aquí. Se descarga como el consolidado que se envía al banco. */
import { GRUPOS_DOCUMENTACION, STATUS_DOCUMENTACION, type GrupoDocumentacion } from "@crm/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Download, LoaderCircle, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Card, EmptyState, PageHeader } from "../components/ui";
import { api, type FilaDocumentacion, type SeguimientoDocumentacion as Datos } from "../lib/api";
import { descargarConsolidado, fechaDMY } from "../lib/consolidadoDoc";

const fmtInt = new Intl.NumberFormat("es-SV");
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "0.0%");
const fechaHora = (ms: number) =>
  new Date(ms).toLocaleString("es-SV", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const llamadaFecha = (iso: string | null) => (iso ? `${fechaDMY(iso)} ${iso.slice(11, 16)}`.trim() : "");

/** Una fila por venta de la sábana, como cuenta el banco (la doble TC son 2 ventas). */
interface Item {
  key: string;
  f: FilaDocumentacion;
  /** Tarjetas de la misma venta (mismo NIU y fecha): la gestión y el "recibido" aplican a todas. */
  tarjetas: number;
  digitos: string;
}

function filasDe(filas: FilaDocumentacion[]): Item[] {
  const porVenta = new Map<string, FilaDocumentacion[]>();
  for (const f of filas) {
    const k = `${f.grupo}|${f.niu}|${f.venta ?? ""}`;
    porVenta.set(k, [...(porVenta.get(k) ?? []), f]);
  }
  return filas.map((f) => {
    const misma = porVenta.get(`${f.grupo}|${f.niu}|${f.venta ?? ""}`)!;
    return { key: String(f.id), f, tarjetas: misma.length, digitos: f.digitos ?? "" };
  });
}

const SIN_GESTION = "__sin_gestion";
const SIN_LLAMADAS = "__sin_llamadas";
const RECIBIDO = "__recibido";

export function SeguimientoDocumentacion() {
  const datos = useQuery({ queryKey: ["seguimiento-doc"], queryFn: api.seguimientoDocumentacion, staleTime: 30_000 });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000 });
  const puedeGestionar = Boolean(me.data?.permissions.includes("datos:cargar"));
  const [grupo, setGrupo] = useState<GrupoDocumentacion>("seguimiento");
  const [buscar, setBuscar] = useState("");
  const [filtro, setFiltro] = useState("");
  const [subetapa, setSubetapa] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const [bajando, setBajando] = useState(false);
  const [error, setError] = useState("");
  // Última venta marcada como recibida, para poder deshacerlo al momento.
  const [marcada, setMarcada] = useState<FilaDocumentacion | null>(null);
  useEffect(() => {
    if (!marcada) return;
    const t = setTimeout(() => setMarcada(null), 12_000);
    return () => clearTimeout(t);
  }, [marcada]);
  const alMarcar = (f: FilaDocumentacion, recibido: boolean) => setMarcada(recibido ? f : null);

  const d = datos.data;
  const todas = useMemo(() => filasDe(d?.filas ?? []), [d]);
  // La cola de trabajo: sin las ventas con el documento recibido.
  const items = useMemo(() => todas.filter((i) => !i.f.recibido), [todas]);
  const recibidas = todas.length - items.length;
  const delGrupo = (g: GrupoDocumentacion) => items.filter((i) => i.f.grupo === g);
  const subetapas = useMemo(() => {
    const m = new Map<string, number>();
    const base = filtro === RECIBIDO ? todas.filter((i) => i.f.recibido) : items;
    for (const i of base) if (i.f.grupo === grupo) m.set(i.f.subetapa ?? "", (m.get(i.f.subetapa ?? "") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [todas, items, grupo, filtro]);
  const lista = useMemo(() => {
    const t = buscar.trim().toLowerCase();
    return (filtro === RECIBIDO ? todas.filter((i) => i.f.recibido) : items).filter((i) => {
      if (i.f.grupo !== grupo) return false;
      if (subetapa && (i.f.subetapa ?? "") !== subetapa) return false;
      if (filtro === SIN_GESTION && i.f.notas.length) return false;
      if (filtro === SIN_LLAMADAS && i.f.llamadas) return false;
      if (filtro && filtro !== SIN_GESTION && filtro !== SIN_LLAMADAS && filtro !== RECIBIDO && i.f.notas[0]?.status !== filtro) return false;
      if (t && !`${i.f.niu} ${i.f.nombre ?? ""} ${i.f.telefono ?? ""}`.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [todas, items, grupo, subetapa, filtro, buscar]);

  const total = items.length;
  const conGestion = items.filter((i) => i.f.notas.length).length;
  const sinLlamadas = items.filter((i) => !i.f.llamadas).length;
  const actual = abierto ? (lista.find((i) => i.key === abierto) ?? todas.find((i) => i.key === abierto) ?? null) : null;
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
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {GRUPOS_DOCUMENTACION.map((g) => (
              <Kpi key={g.id} label={g.label} valor={delGrupo(g.id).length} pie={`${pct(delGrupo(g.id).length, total)} de ${fmtInt.format(total)} ventas en la cola`} />
            ))}
            <Kpi
              label="Documento recibido"
              valor={recibidas}
              pie={`${pct(recibidas, todas.length)} de ${fmtInt.format(todas.length)} ventas`}
              activo={filtro === RECIBIDO}
              onClick={() => {
                setFiltro(filtro === RECIBIDO ? "" : RECIBIDO);
                setSubetapa("");
              }}
            />
            <Kpi label="Con gestión" valor={conGestion} pie={`${pct(conGestion, total)} de ${fmtInt.format(total)} ventas en la cola`} />
            <Kpi label="Sin llamadas después de la venta" valor={sinLlamadas} pie={`${pct(sinLlamadas, total)} de ${fmtInt.format(total)} ventas en la cola`} />
          </div>

          <Card className="p-0!">
            <div className="flex flex-wrap items-center gap-3 border-b border-hair px-5 py-4">
              <div className="flex rounded-full border border-hair p-1" role="tablist">
                {GRUPOS_DOCUMENTACION.map((g) => (
                  <button
                    key={g.id}
                    role="tab"
                    aria-selected={grupo === g.id}
                    onClick={() => {
                      setGrupo(g.id);
                      setSubetapa("");
                    }}
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
                <option value={RECIBIDO}>Documento recibido ({fmtInt.format(recibidas)})</option>
                {STATUS_DOCUMENTACION.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-b border-hair px-5 py-3" aria-label="Subetapa">
              {[["", subetapas.reduce((a, [, n]) => a + n, 0)] as [string, number], ...subetapas].map(([sub, n]) => (
                <button
                  key={sub || "todas"}
                  type="button"
                  aria-pressed={subetapa === sub}
                  onClick={() => setSubetapa(sub)}
                  className={`rounded-full border px-3 py-1 text-[12.5px] transition-colors ${subetapa === sub ? "border-brand-500 bg-brand-500/10 font-medium text-brand-600" : "border-hair text-ink-soft hover:text-ink"}`}
                >
                  {sub || "Todas"} <span className="tabular-nums">{fmtInt.format(n)}</span>
                </button>
              ))}
            </div>
            <Tabla grupo={grupo} lista={lista} onAbrir={setAbierto} puedeGestionar={puedeGestionar} onRecibido={alMarcar} />
          </Card>
        </>
      )}
      {actual && d && (
        <Gestion item={actual} puedeGestionar={puedeGestionar} puedeEliminar={Boolean(d.puedeEliminar)} onClose={() => setAbierto(null)} onSiguiente={siguiente} hayOtro={lista.findIndex((i) => i.key === abierto) < lista.length - 1} onRecibido={alMarcar} />
      )}
      {marcada && <Deshacer f={marcada} onListo={() => setMarcada(null)} />}
    </>
  );
}

function Kpi({ label, valor, pie, activo, onClick }: { label: string; valor: number; pie: string; activo?: boolean; onClick?: () => void }) {
  const cuerpo = (
    <>
      <p className="text-[12.5px] text-ink-soft">{label}</p>
      <p className="mt-1 text-[26px] leading-tight font-semibold text-ink tabular-nums">{fmtInt.format(valor)}</p>
      <p className="mt-1 text-[12px] text-ink-faint">{pie}</p>
    </>
  );
  if (!onClick) return <Card>{cuerpo}</Card>;
  return (
    <button type="button" onClick={onClick} aria-pressed={activo} className={`rounded-[20px] text-left transition-shadow ${activo ? "ring-2 ring-brand-500" : "hover:ring-1 hover:ring-hair"}`}>
      <Card>{cuerpo}</Card>
    </button>
  );
}

/** Aviso al marcar "documento recibido", con la opción de deshacerlo. */
function Deshacer({ f, onListo }: { f: FilaDocumentacion; onListo: () => void }) {
  const m = useRecibido();
  return (
    <div role="status" className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-full bg-slate-900 px-5 py-3 text-[13px] text-white shadow-lg dark:bg-slate-700">
      <span>
        NIU {f.niu} · documento recibido, fuera de la cola
        {m.isError && <span className="ml-2 text-red-300">{m.error.message}</span>}
      </span>
      <button
        type="button"
        disabled={m.isPending}
        onClick={() => m.mutate({ f, recibido: false }, { onSuccess: onListo })}
        className="rounded-full px-2 py-0.5 font-semibold text-sky-300 hover:text-sky-200 disabled:opacity-50"
      >
        {m.isPending ? "Deshaciendo…" : "Deshacer"}
      </button>
      <button type="button" onClick={onListo} aria-label="Cerrar aviso" className="text-white/60 hover:text-white">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** Marca o desmarca "documento recibido" de una venta (todas sus tarjetas). */
function useRecibido() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ f, recibido }: { f: FilaDocumentacion; recibido: boolean }) => conEspera(api.recibidoDocumentacion({ niu: f.niu, venta: f.venta ?? "", recibido })),
    onSuccess: (r, { f }) =>
      qc.setQueryData<Datos>(["seguimiento-doc"], (old) =>
        old && { ...old, filas: old.filas.map((x) => (x.niu === f.niu && (x.venta ?? "") === (f.venta ?? "") ? { ...x, recibido: r } : x)) },
      ),
  });
}

function CheckRecibido({ f, disabled, onCambio }: { f: FilaDocumentacion; disabled?: boolean; onCambio?: (f: FilaDocumentacion, recibido: boolean) => void }) {
  const m = useRecibido();
  return (
    <input
      type="checkbox"
      checked={Boolean(f.recibido)}
      disabled={disabled || m.isPending}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => {
        const recibido = e.target.checked;
        m.mutate({ f, recibido }, { onSuccess: () => onCambio?.(f, recibido) });
      }}
      aria-label={`Documento recibido de NIU ${f.niu}`}
      title={m.isError ? m.error.message : f.recibido ? `Recibido · ${fechaHora(f.recibido.fecha)} · ${f.recibido.por}` : "Marcar documento recibido"}
      className="size-4 cursor-pointer accent-[var(--color-brand-500,#2563eb)] disabled:cursor-default disabled:opacity-50"
    />
  );
}

function Tabla({
  grupo,
  lista,
  onAbrir,
  puedeGestionar,
  onRecibido,
}: {
  grupo: GrupoDocumentacion;
  lista: Item[];
  onAbrir: (k: string) => void;
  puedeGestionar: boolean;
  onRecibido: (f: FilaDocumentacion, recibido: boolean) => void;
}) {
  if (!lista.length) return <p className="p-6 text-sm text-ink-soft">No hay ventas con este filtro.</p>;
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
            <th className="border-b border-hair py-3 pl-5 text-left font-normal whitespace-nowrap">Doc. recibido</th>
            {cols.map((c) => (
              <th key={c.label} className={`border-b border-hair px-3 py-3 font-normal whitespace-nowrap last:pr-5 ${num(c.label) ? "text-right" : "text-left"}`}>
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
              <td className="py-2.5 pl-5 text-center" onClick={(e) => e.stopPropagation()}>
                <CheckRecibido f={i.f} disabled={!puedeGestionar} onCambio={onRecibido} />
              </td>
              {cols.map((c, j) => {
                const v = c.cell(i);
                return (
                  <td
                    key={c.label}
                    className={`max-w-44 truncate px-3 py-2.5 whitespace-nowrap last:pr-5 ${j === 0 ? "font-medium text-ink tabular-nums" : "text-ink/80"} ${num(c.label) ? "text-right tabular-nums" : ""}`}
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

/** Si el CRM no responde en este tiempo, se avisa en vez de quedarse esperando. */
const ESPERA_MAX = 20_000;
function conEspera<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("El CRM no respondió en 20 segundos. Revisa tu conexión y vuelve a intentar.")), ESPERA_MAX)),
  ]);
}

function Gestion({
  item,
  puedeGestionar,
  puedeEliminar,
  onClose,
  onSiguiente,
  hayOtro,
  onRecibido,
}: {
  item: Item;
  puedeGestionar: boolean;
  puedeEliminar: boolean;
  onClose: () => void;
  onSiguiente: () => void;
  hayOtro: boolean;
  onRecibido: (f: FilaDocumentacion, recibido: boolean) => void;
}) {
  const qc = useQueryClient();
  const f = item.f;
  // El STATUS arranca en el último guardado del cliente.
  const [status, setStatus] = useState(f.notas[0]?.status ?? "");
  const [comentario, setComentario] = useState("");
  const [guardado, setGuardado] = useState("");
  const [borrar, setBorrar] = useState<number | null>(null);
  const siguienteRef = useRef(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    setStatus(f.notas[0]?.status ?? "");
    setComentario("");
    setGuardado("");
    setBorrar(null);
  }, [item.key]); // eslint-disable-line react-hooks/exhaustive-deps
  // Solo al abrir: el foco va al botón de cerrar (no en cada cambio de la pantalla, para no cerrar la lista de STATUS).
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const quitar = (lista: (typeof f.notas)[number][], id: number) => lista.filter((n) => n.id !== id);
  const eliminar = useMutation({
    mutationFn: (id: number) => conEspera(api.eliminarGestionDocumentacion(id)),
    onSuccess: (_, id) => {
      qc.setQueryData<Datos>(["seguimiento-doc"], (old) => old && { ...old, filas: old.filas.map((x) => ({ ...x, notas: quitar(x.notas, id) })), historial: old.historial.filter((n) => n.id !== id) });
      setBorrar(null);
    },
  });

  const guardar = useMutation({
    mutationFn: () => conEspera(api.gestionDocumentacion({ niu: f.niu, venta: f.venta ?? "", status, comentario })),
    onSuccess: (nota) => {
      // La gestión queda al frente de la venta y del historial, sin volver a pedir toda la cola.
      qc.setQueryData<Datos>(["seguimiento-doc"], (old) =>
        old && {
          ...old,
          filas: old.filas.map((x) => (x.niu === f.niu && (x.venta ?? "") === nota.venta ? { ...x, notas: [nota, ...x.notas] } : x)),
          historial: [{ ...nota, nombre: f.nombre, subetapa: f.subetapa }, ...old.historial],
        },
      );
      setComentario("");
      setGuardado(`Guardado: ${nota.status}`);
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

          <label className={`mt-5 flex items-center gap-3 rounded-2xl border px-4 py-3 ${f.recibido ? "border-emerald-500/40 bg-emerald-500/5" : "border-hair"}`}>
            <CheckRecibido f={f} disabled={!puedeGestionar} onCambio={onRecibido} />
            <span className="text-[13.5px] text-ink">
              Documento recibido
              {f.recibido && (
                <span className="block text-[12px] text-ink-soft">
                  {fechaHora(f.recibido.fecha)} · {f.recibido.por} · fuera de la cola de trabajo
                </span>
              )}
            </span>
          </label>

          {puedeGestionar && (
            <form onSubmit={(e) => submit(e, false)} className="mt-6 rounded-2xl border border-hair p-4">
              <p className="text-[13px] font-medium text-ink">Registrar gestión</p>
              <label className="mt-3 block">
                <span className="text-[12px] text-ink-faint">STATUS</span>
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setGuardado("");
                  }}
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
              {guardado && !guardar.isError && !guardar.isPending && <p className="mt-2 text-[13px] text-emerald-600" aria-live="polite">{guardado}</p>}
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
                    <span className="flex items-center gap-2 text-[12px] text-ink-faint">
                      {fechaHora(n.fecha)} · {n.por}
                      {puedeEliminar && borrar !== n.id && (
                        <button type="button" onClick={() => setBorrar(n.id)} className="rounded-full p-1 text-ink-faint hover:bg-paper hover:text-[var(--st-critical)]" aria-label="Eliminar comentario" title="Eliminar">
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </span>
                  </div>
                  {n.comentario && <p className="mt-1 text-[13px] text-ink/80">{n.comentario}</p>}
                  {borrar === n.id && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
                      <span className="text-ink-soft">¿Eliminar este comentario?</span>
                      <button
                        type="button"
                        onClick={() => eliminar.mutate(n.id)}
                        disabled={eliminar.isPending}
                        className="rounded-lg bg-red-600 px-3 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        {eliminar.isPending ? "Eliminando…" : "Eliminar"}
                      </button>
                      <button type="button" onClick={() => setBorrar(null)} className="rounded-lg border border-hair px-3 py-1 text-ink hover:bg-paper">
                        Cancelar
                      </button>
                      {eliminar.isError && <span className="text-[var(--st-critical)]">{eliminar.error.message}</span>}
                    </div>
                  )}
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
