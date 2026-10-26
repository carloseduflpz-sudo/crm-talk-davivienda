/* Presentación semanal: la presentación de la semana anterior con las cifras de lo último que se cargó.
   Solo cambian los números: diseño, colores, imágenes y las láminas de CDC, Extra y Seguros quedan igual.
   Todo se arma aquí, en el navegador; el servidor solo da las cifras y guarda la plantilla. */
import { CAMPAIGNS, Pptx, PRES_CAMPANAS, llenarPresentacion, nombreMes, semanaDe, type PresDatos, type PresResultado, type PresentacionCampania } from "@crm/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, CloudUpload, Download, LoaderCircle, Presentation as PresentationIcon, TriangleAlert } from "lucide-react";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { Card, PageHeader } from "../components/ui";
import { api, type PlantillaInfo } from "../lib/api";
import { currentMonth, monthFromName, monthLabel } from "../lib/xlsx";

const fmtDate = (ms: number) => new Date(ms).toLocaleString("es-SV", { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
const fmtDay = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("es-SV", { day: "numeric", month: "long" });
const PPTX_TYPE = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

/** Nombre del archivo nuevo a partir del de la plantilla: "ppt_w4_octubre" → "ppt_w5_octubre". */
export function nombreSalida(plantilla: string, mes: string, semana: number | null): string {
  const base = plantilla.replace(/\.pptx$/i, "");
  const mesNombre = nombreMes(mes).toLowerCase();
  const MES_RE = /(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)/i;
  let out = MES_RE.test(base)
    ? base.replace(MES_RE, (w) => (w[0] === w[0]!.toUpperCase() ? mesNombre.charAt(0).toUpperCase() + mesNombre.slice(1) : mesNombre))
    : `${base}_${mesNombre}`;
  if (semana) out = /w\s*\d+/i.test(out) ? out.replace(/(w)\s*\d+/i, (_, w: string) => `${w}${semana}`) : out.replace(new RegExp(`_${mesNombre}$`), `_w${semana}_${mesNombre}`);
  return `${out}.pptx`;
}

/** Cifras de las 6 campañas del mes. Si una campaña no tiene datos de ese mes, el servidor da su último mes: eso no se usa (no se mezclan meses). */
async function cargarDatos(mes: string): Promise<PresDatos> {
  const all = await Promise.all(CAMPAIGNS.map((c) => api.presentacionDatos(c.code, mes).catch(() => null)));
  const out: PresDatos = {};
  CAMPAIGNS.forEach((c, i) => {
    const d = all[i];
    if (d && d.month === mes) out[c.code] = d;
  });
  return out;
}

/** Semana del mes de la sábana más reciente (para el nombre del archivo). */
function semanaActual(datos: PresDatos, mes: string): number | null {
  const corte = Object.values(datos).map((d) => d.fechaCorte).filter((x): x is string => Boolean(x && x.startsWith(mes))).sort().pop();
  return corte ? semanaDe(mes, corte) : null;
}

function lastMonths(n: number): string[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => currentMonth(new Date(now.getFullYear(), now.getMonth() - i, 15)));
}

function download(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: PPTX_TYPE }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function Presentation() {
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const canSave = me.data?.permissions.includes("reportes:generar") ?? false;
  const plantilla = useQuery({ queryKey: ["plantilla"], queryFn: api.plantilla });
  const [mes, setMes] = useState(currentMonth());

  // Al volver a esta pestaña (p. ej. después de cargar una sábana) se piden de nuevo.
  const datos = useQuery({ queryKey: ["presentacion", mes], queryFn: () => cargarDatos(mes), refetchOnWindowFocus: true });

  const [result, setResult] = useState<{ res: PresResultado; nombre: string; guardada: boolean } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const semana = useMemo(() => semanaActual(datos.data ?? {}, mes), [datos.data, mes]);

  const generar = async () => {
    const p = plantilla.data;
    if (!p) return;
    setError("");
    setResult(null);
    try {
      // Las cifras se piden de nuevo al dar clic: si se acaba de cargar una sábana, ya sale con ella.
      setBusy("Leyendo lo último que se cargó…");
      const frescos = await cargarDatos(mes);
      void qc.invalidateQueries({ queryKey: ["presentacion", mes] });
      setBusy("Abriendo la presentación…");
      const deck = Pptx.open(await api.plantillaArchivo());
      setBusy("Poniendo las cifras…");
      const res = await llenarPresentacion(deck, frescos, { mesPlantilla: p.mes });
      const bytes = await deck.save();
      const nombre = nombreSalida(p.nombre, mes, semanaActual(frescos, mes));
      download(bytes, nombre);
      let guardada = false;
      if (canSave) {
        setBusy("Guardándola como base de la próxima semana…");
        await api.guardarPlantilla(new Blob([bytes], { type: PPTX_TYPE }), { mes, nombre, origen: "generada" });
        guardada = true;
        void qc.invalidateQueries({ queryKey: ["plantilla"] });
      }
      setResult({ res, nombre, guardada });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  const listas = Object.keys(datos.data ?? {}).length;
  return (
    <>
      <PageHeader
        title="Presentación"
        subtitle="Tu presentación de la semana con las cifras de lo último que cargaste. Solo cambian los números: el diseño queda idéntico."
      />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PlantillaCard info={plantilla.data ?? null} loading={plantilla.isPending} canSave={canSave} onSaved={() => void qc.invalidateQueries({ queryKey: ["plantilla"] })} />

        <Card>
          <h2 className="text-[15px] font-semibold text-ink">Mes de las cifras</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {lastMonths(4).map((m) => (
              <button
                key={m}
                onClick={() => setMes(m)}
                aria-pressed={mes === m}
                className={`rounded-full border px-3 py-1 text-[13px] capitalize ${mes === m ? "border-brand-500 bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/15 dark:text-white" : "border-hair text-ink-soft hover:border-brand-500/50"}`}
              >
                {monthLabel(m)}
              </button>
            ))}
          </div>
          <ul className="mt-4 divide-y divide-hair text-[13px]">
            {CAMPAIGNS.map((c) => {
              const d = datos.data?.[c.code];
              const propia = PRES_CAMPANAS.includes(c.code);
              return (
                <li key={c.code} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="font-medium text-ink">{c.shortName}</span>
                  <span className="text-right text-ink-soft">
                    {datos.isPending ? "…" : d ? <EstadoCampana d={d} /> : <span className="text-amber-700 dark:text-amber-400">Sin datos de {nombreMes(mes).toLowerCase()}: sus cifras quedan como estaban</span>}
                    {!propia && d && <span className="block text-[12px]">Solo en las láminas generales; sus láminas propias no se tocan</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <button
          onClick={() => void generar()}
          disabled={!plantilla.data || !listas || Boolean(busy)}
          className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
          {busy || `Descargar presentación${semana ? ` de la semana ${semana}` : ""}`}
        </button>
        {!plantilla.data && !plantilla.isPending && <p className="text-[13px] text-ink-soft">Primero sube tu presentación de la semana pasada.</p>}
        {plantilla.data && !listas && !datos.isPending && <p className="text-[13px] text-ink-soft">No hay nada cargado de {monthLabel(mes)}.</p>}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}

      {result && <Resultado {...result} />}
    </>
  );
}

function EstadoCampana({ d }: { d: PresentacionCampania }) {
  const num = (v: number) => (d.unidad === "monto" ? `$${Math.round(v).toLocaleString("en-US")}` : Math.round(v).toLocaleString("en-US"));
  const meta = d.meta === null ? "sin meta del mes" : `meta del mes ${num(d.meta)}`;
  const mtd =
    d.esperado === null || !d.esperado ? null : `Meta MTD ${num(d.esperado)} (${d.diasHabiles.transcurridos} de ${d.diasHabiles.total} días hábiles) · cumplimiento ${Math.round((d.resultado / d.esperado) * 100)}%`;
  const faltan = [!d.bases.length && "base", !d.ventas.length && "sábana", !d.motivos.length && "tipificaciones"].filter(Boolean);
  return (
    <>
      {d.fechaCorte ? `Ventas al ${fmtDay(d.fechaCorte)}` : "Sin sábana"} · {meta}
      {mtd && <span className="block text-[12px]">{mtd}</span>}
      {faltan.length > 0 && <span className="block text-[12px] text-amber-700 dark:text-amber-400">Falta: {faltan.join(", ")}</span>}
      {d.fechasPosteriores && (
        <span className="block text-[12px] text-amber-700 dark:text-amber-400">
          La sábana trae {d.fechasPosteriores.filas} {d.fechasPosteriores.filas === 1 ? "venta" : "ventas"} con fecha posterior al día en que se cargó (hasta el{" "}
          {fmtDay(d.fechasPosteriores.hasta)}): no se toman para el corte
        </span>
      )}
    </>
  );
}

function PlantillaCard({ info, loading, canSave, onSaved }: { info: PlantillaInfo | null; loading: boolean; canSave: boolean; onSaved: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mes, setMes] = useState("");
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const pick = (f: File) => {
    setError("");
    if (!/\.pptx$/i.test(f.name)) {
      setError("Tiene que ser la presentación de PowerPoint (.pptx).");
      return;
    }
    setFile(f);
    setMes(monthFromName(f.name) ?? currentMonth());
  };
  const save = async () => {
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      // Se revisa que se pueda abrir antes de guardarla.
      Pptx.open(new Uint8Array(await file.arrayBuffer()));
      await api.guardarPlantilla(file, { mes, nombre: file.name, origen: "subida" });
      setFile(null);
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && canSave) pick(f);
  };

  return (
    <Card>
      <h2 className="text-[15px] font-semibold text-ink">Presentación base</h2>
      {loading ? (
        <p className="mt-3 text-sm text-ink-soft">…</p>
      ) : info && !file ? (
        <div className="mt-3 flex items-start gap-3">
          <PresentationIcon className="mt-0.5 size-5 shrink-0 text-accent-500" aria-hidden />
          <div className="min-w-0 text-[13px]">
            <p className="truncate font-medium text-ink">{info.nombre}</p>
            <p className="text-ink-soft">
              {info.origen === "generada" ? "Generada aquí" : "Subida"} por {info.por} el {fmtDate(info.fecha)}
              {info.mes ? ` · cifras de ${monthLabel(info.mes)}` : ""}
            </p>
            <p className="mt-2 text-ink-soft">Cada descarga queda como base de la siguiente, así las semanas ya cerradas se respetan. Si cambiaste el diseño a mano, súbela de nuevo.</p>
            {canSave && (
              <button onClick={() => input.current?.click()} className="mt-2 text-[13px] font-medium text-brand-600 hover:underline">
                Subir otra presentación
              </button>
            )}
          </div>
        </div>
      ) : !file ? (
        <div
          role="button"
          tabIndex={0}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => canSave && input.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && canSave && input.current?.click()}
          className={`mt-3 flex cursor-pointer flex-col items-center rounded-2xl border-2 border-dashed px-6 py-8 text-center ${dragging ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-slate-300 hover:border-brand-500/60 dark:border-slate-700"}`}
        >
          <CloudUpload className="mb-2 size-8 text-brand-500" aria-hidden />
          <p className="text-sm font-medium">{canSave ? "Arrastra aquí tu presentación de la semana pasada (.pptx)" : "Todavía no hay presentación base. Pídele a quien genera los reportes que la suba."}</p>
          <p className="mt-1 text-[13px] text-ink-soft">Se usa tal cual: de ella salen el diseño, el orden de las láminas y las semanas ya cerradas.</p>
        </div>
      ) : (
        <div className="mt-3 text-[13px]">
          <p className="truncate font-medium text-ink">{file.name}</p>
          <label className="mt-3 block text-ink-soft">
            ¿De qué mes son las cifras que trae?
            <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="mt-1 block rounded-lg border border-hair bg-white px-2 py-1 text-ink dark:bg-slate-900" />
          </label>
          <p className="mt-2 text-ink-soft">Si es del mismo mes que vas a presentar, las semanas que ya pasaron se dejan como están y solo se calcula la semana actual.</p>
          <div className="mt-3 flex gap-3">
            <button onClick={() => void save()} disabled={saving || !mes} className="rounded-xl bg-brand-500 px-4 py-2 font-medium text-white hover:bg-brand-600 disabled:opacity-50">
              {saving ? "Guardando…" : "Usar esta presentación"}
            </button>
            <button onClick={() => setFile(null)} className="px-2 text-ink-soft hover:text-ink">
              Cancelar
            </button>
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept=".pptx"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pick(f);
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {error}
        </p>
      )}
    </Card>
  );
}

function rangos(ns: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < ns.length; i++) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j]! + 1) j++;
    out.push(j > i ? `${ns[i]}–${ns[j]}` : String(ns[i]));
    i = j;
  }
  return out.join(", ");
}

function Resultado({ res, nombre, guardada }: { res: PresResultado; nombre: string; guardada: boolean }) {
  const porLamina = useMemo(() => {
    const m = new Map<number, { titulo: string; cambios: PresResultado["cambios"] }>();
    for (const c of res.cambios) {
      const e = m.get(c.lamina) ?? { titulo: c.titulo, cambios: [] };
      e.cambios.push(c);
      m.set(c.lamina, e);
    }
    return [...m.entries()];
  }, [res]);
  const [open, setOpen] = useState(false);

  return (
    <section className="mt-8" aria-labelledby="cambios">
      <div className="flex items-start gap-3">
        <Check className="mt-1 size-5 shrink-0 text-emerald-600" aria-hidden />
        <div>
          <h2 id="cambios" className="text-[17px] font-semibold text-ink">
            {nombre} descargada
          </h2>
          <p className="text-[13px] text-ink-soft">
            {res.cambios.length} cifras actualizadas en {porLamina.length} láminas. Sin cambios: láminas {rangos(res.intactas.map((x) => x.lamina))}.
            {guardada && " Quedó como base de la próxima semana."}
          </p>
        </div>
      </div>

      {res.sinCambio.length > 0 && (
        <Card className="mt-4 border-amber-300 dark:border-amber-500/40">
          <h3 className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            <TriangleAlert className="size-4 text-amber-600" aria-hidden /> Se dejó como estaba
          </h3>
          <ul className="mt-2 space-y-1 text-[13px]">
            {res.sinCambio.map((s, i) => (
              <li key={i}>
                <span className="font-medium text-ink">
                  Lámina {s.lamina} · {s.bloque}
                </span>
                <span className="text-ink-soft"> — {s.motivo}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="mt-4 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-ink">Cifra por cifra: antes y ahora</h3>
        <button onClick={() => setOpen((o) => !o)} className="text-[13px] font-medium text-brand-600 hover:underline">
          {open ? "Cerrar todas" : "Abrir todas"}
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {porLamina.map(([lamina, l]) => (
          <details key={`${lamina}-${open}`} open={open} className="group rounded-2xl border border-hair bg-white dark:bg-slate-900">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px]">
              <span>
                <span className="font-semibold text-ink">Lámina {lamina}</span> <span className="text-ink-soft">{l.titulo}</span>
              </span>
              <span className="flex items-center gap-2 text-ink-soft">
                {l.cambios.length} cifras <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden />
              </span>
            </summary>
            <div className="overflow-x-auto px-4 pb-3">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-ink-soft">
                    <th className="py-1 pr-3 font-medium">Dónde</th>
                    <th className="py-1 pr-3 font-medium">Dato</th>
                    <th className="py-1 pr-3 text-right font-medium">Antes</th>
                    <th className="py-1 text-right font-medium">Ahora</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hair">
                  {l.cambios.map((c, i) => (
                    <tr key={i}>
                      <td className="py-1 pr-3 text-ink-soft">{c.bloque}</td>
                      <td className="py-1 pr-3 text-ink">{c.dato}</td>
                      <td className="py-1 pr-3 text-right text-ink-soft tabular-nums">{c.antes}</td>
                      <td className="py-1 text-right font-medium text-ink tabular-nums">{c.ahora}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}
