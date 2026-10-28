/* Centro de carga: arrastrar el Excel → la app lo reconoce y lo valida → vista previa →
   se guarda por lotes con versión, sin borrar la versión anterior. */
import { CAMPAIGNS, PREVIEW_HIDDEN, chunkEnds, compareSabanas, getCampaign, summarizeSales, onlyMonth, rowsByMonth, isCampaignCode, type CampaignCode, type ExcelReading, type NormalizedRow, type UploadKind } from "@crm/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, CircleCheck, CloudUpload, Download, FileArchive, FileSpreadsheet, LoaderCircle, RotateCcw, Target, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { dayLabel } from "../components/charts";
import { Button, ErrorMessage } from "../components/form";
import { Badge, Card, PageHeader } from "../components/ui";
import { ApiError, api, type UploadInfo } from "../lib/api";
import { ExcelReader, ReadCancelled } from "../lib/excel";
import { monthFromName, monthLabel } from "../lib/xlsx";

const ACCEPT = ".xlsx,.xlsb,.xls,.csv";
const MAX_BACKUP_BYTES = 60 * 1024 * 1024;

/** Lo que devolvió el lector en segundo plano, más el archivo y su huella. */
interface Analysis extends ExcelReading {
  file: File;
  sha: string;
}

type Phase = { name: "idle" } | { name: "reading"; fileName: string; step: string } | { name: "ready" } | { name: "saving"; done: number; total: number; step: string } | { name: "done"; upload: UploadInfo; warning?: string; others?: string[] };

const fmt = new Intl.NumberFormat("es-SV");
const fmtDate = (ms: number) => new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
/** Mes de hoy en la hora local (no en UTC: el último día del mes en la noche sigue siendo ese mes). */
const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const currentMonth = () => monthOf(new Date());
const previousMonth = () => {
  const d = new Date();
  return monthOf(new Date(d.getFullYear(), d.getMonth() - 1, 1));
};
const VALID_MONTH = /^20\d{2}-(0[1-9]|1[0-2])$/;
const datasetLabel = (id: string) => {
  const [c] = id.split(":");
  return (isCampaignCode(c ?? "") ? getCampaign(c as CampaignCode).datasets.find((d) => d.id === id)?.label : null) ?? id;
};

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const retryable = !(e instanceof ApiError) || e.status >= 500;
      if (!retryable || i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
}

/* ---------- vista previa ---------- */

const PREVIEW_COLS: Record<UploadKind, [string, string][]> = {
  sabana: [["niu", "NIU"], ["saleDate", "Fecha venta"], ["executive", "Ejecutivo"], ["statusRaw", "Estatus banco"], ["process", "Proceso"], ["reason", "Motivo"]],
  base: [["niu", "NIU"], ["profile", "Perfil"], ["offer", "Oferta"]],
  tipif: [["niu", "NIU"], ["calledAt", "Fecha y hora"], ["agent", "Agente"], ["category", "Categoría"], ["tipologia", "Tipología"]],
  ventas: [["niu", "NIU"], ["enteredAt", "Ingreso"], ["agent", "Agente"], ["product", "Producto"]],
};

function Preview({ rows, kind, datasetId }: { rows: NormalizedRow[]; kind: UploadKind; datasetId: string }) {
  const hidden = new Set(PREVIEW_HIDDEN[datasetId] ?? []);
  const cols = PREVIEW_COLS[kind].filter(([k]) => rows.slice(0, 8).some((r) => (r as unknown as Record<string, unknown>)[k] != null && (r as unknown as Record<string, unknown>)[k] !== ""));
  const extraKeys = [...new Set(rows.slice(0, 8).flatMap((r) => Object.keys(r.extra)))].filter((k) => !hidden.has(k)).slice(0, 4);
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase dark:bg-slate-800/50">
          <tr>
            {cols.map(([, label]) => (
              <th key={label} className="px-3 py-2 font-semibold whitespace-nowrap">
                {label}
              </th>
            ))}
            {extraKeys.map((k) => (
              <th key={k} className="px-3 py-2 font-semibold whitespace-nowrap">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.slice(0, 8).map((r, i) => {
            const rec = r as unknown as Record<string, unknown>;
            return (
              <tr key={i}>
                {cols.map(([k]) => (
                  <td key={k} className="max-w-56 truncate px-3 py-2 whitespace-nowrap">
                    {String(rec[k] ?? "") || <span className="text-slate-300">—</span>}
                  </td>
                ))}
                {extraKeys.map((k) => (
                  <td key={k} className="max-w-56 truncate px-3 py-2 whitespace-nowrap text-slate-500">
                    {String(r.extra[k] ?? "")}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, tone = "default", foot }: { label: string; value: string; tone?: "default" | "warn"; foot?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone === "warn" ? "text-accent-500" : ""}`}>{value}</p>
      {foot && <p className="mt-0.5 text-xs text-slate-500">{foot}</p>}
    </div>
  );
}

/* ---------- historial ---------- */

const STATUS_BADGE: Record<UploadInfo["status"], { label: string; tone: "brand" | "neutral" | "accent" }> = {
  vigente: { label: "Vigente", tone: "brand" },
  reemplazada: { label: "Versión anterior", tone: "neutral" },
  validando: { label: "Incompleta", tone: "accent" },
  descartada: { label: "Descartada", tone: "neutral" },
};

function History({ campaign, canRestore }: { campaign: CampaignCode; canRestore: boolean }) {
  const qc = useQueryClient();
  const uploads = useQuery({ queryKey: ["uploads", campaign], queryFn: () => api.uploads(campaign) });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Una sección desplegable por mes; el más reciente abierto.
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>({});
  const byMonth = useMemo(() => {
    const m = new Map<string, UploadInfo[]>();
    for (const u of uploads.data ?? []) m.set(u.month, [...(m.get(u.month) ?? []), u]);
    return [...m].sort(([a], [b]) => b.localeCompare(a));
  }, [uploads.data]);
  /** Qué pasa al eliminar, dicho antes de hacerlo. */
  const deleteMessage = (u: UploadInfo) => {
    const what = `${datasetLabel(u.dataset)}${u.isAddition && u.label ? ` "${u.label}"` : ""} de ${monthLabel(u.month)} (versión ${u.version}, ${fmt.format(u.rowsValid)} filas)`;
    if (!u.isCurrent) return `¿Eliminar ${what}? No está vigente: se borran sus filas. No se puede deshacer.`;
    if (u.isAddition) return `¿Eliminar ${what}? Deja de sumarse a la base de ${monthLabel(u.month)} y se borran sus filas. No se puede deshacer.`;
    const older = uploads.data?.some((x) => x.dataset === u.dataset && x.month === u.month && x.id !== u.id && !x.isAddition && x.status === "reemplazada");
    return `¿Eliminar ${what}? Es el archivo vigente: se borran sus filas y ${monthLabel(u.month)} se queda sin este archivo hasta que cargues otro${
      older ? " o vuelvas a activar una versión anterior" : ""
    }. No se puede deshacer.`;
  };
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError("");
    try {
      await fn();
      // La ficha del cliente también se arma con estos archivos: se vuelve a consultar.
      await Promise.all([qc.invalidateQueries({ queryKey: ["uploads"] }), qc.invalidateQueries({ queryKey: ["analysis"] }), qc.invalidateQueries({ queryKey: ["cliente"] })]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo completar la acción.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
        <h2 className="font-semibold">Historial de cargas · {getCampaign(campaign).shortName}</h2>
        {uploads.data && (
          <span className="flex items-center gap-3 text-sm text-slate-500">
            {byMonth.length === 1 ? "1 mes" : `${byMonth.length} meses`} · {uploads.data.length === 1 ? "1 archivo" : `${uploads.data.length} archivos`}
            {byMonth.length > 1 && (
              <button
                type="button"
                onClick={() => {
                  const allOpen = byMonth.every(([m], i) => openMonths[m] ?? i === 0);
                  setOpenMonths(Object.fromEntries(byMonth.map(([m]) => [m, !allOpen])));
                }}
                className="rounded-lg px-2 py-1 text-xs font-medium text-brand-600 hover:bg-brand-50 dark:hover:bg-brand-500/10"
              >
                {byMonth.every(([m], i) => openMonths[m] ?? i === 0) ? "Cerrar todos" : "Abrir todos"}
              </button>
            )}
          </span>
        )}
      </div>
      {error && <div className="px-5 pt-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {uploads.isPending && <p className="p-5 text-sm text-slate-500">Cargando historial…</p>}
      {uploads.isError && <p className="p-5 text-sm text-red-600">{uploads.error.message}</p>}
      {uploads.data?.length === 0 && <p className="p-5 text-sm text-slate-500">Todavía no hay archivos cargados para esta campaña.</p>}
      {!!uploads.data?.length && (
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {byMonth.map(([month, list], i) => {
            const isOpen = openMonths[month] ?? i === 0;
            const vigentes = list.filter((u) => u.isCurrent);
            const anteriores = list.length - vigentes.length;
            return (
              <details key={month} open={isOpen} onToggle={(e) => {
                  const open = (e.currentTarget as HTMLDetailsElement).open;
                  if (open !== isOpen) setOpenMonths((o) => ({ ...o, [month]: open }));
                }} className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-4 shrink-0 text-slate-400 transition-transform group-open:rotate-90" aria-hidden />
                  <span className="font-semibold capitalize">{monthLabel(month)}</span>
                  <span className="flex flex-1 flex-wrap gap-1.5">
                    {vigentes.map((u) => (
                      <span key={u.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {u.isAddition ? u.label || "Base adicional" : datasetLabel(u.dataset)}
                      </span>
                    ))}
                  </span>
                  <span className="text-xs text-slate-500">
                    {vigentes.length === 1 ? "1 vigente" : `${vigentes.length} vigentes`}
                    {anteriores > 0 && ` · ${anteriores === 1 ? "1 anterior" : `${anteriores} anteriores`}`}
                  </span>
                </summary>
                <div className="overflow-x-auto pb-2">
                  <table className="w-full min-w-[720px] table-fixed text-left text-sm">
                    <colgroup>
                      <col />
                      <col className="w-20" />
                      <col className="w-24" />
                      <col className="w-36" />
                      <col className="w-44" />
                      <col className="w-48" />
                    </colgroup>
                    <thead className="text-xs text-slate-500 uppercase">
                      <tr className="border-y border-slate-100 dark:border-slate-800">
                        <th className="px-5 py-2 pl-14 font-semibold">Archivo</th>
                        <th className="px-3 py-2 font-semibold">Versión</th>
                        <th className="px-3 py-2 text-right font-semibold">Filas</th>
                        <th className="px-3 py-2 font-semibold">Estado</th>
                        <th className="px-3 py-2 font-semibold">Cargado</th>
                        <th className="px-5 py-2" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {list.map((u) => (
                    <tr key={u.id} className={u.isCurrent ? "" : "text-slate-500"}>
                      <td className="px-5 py-3 pl-14">
                        <p className="flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200">
                          {datasetLabel(u.dataset)}
                          {u.isAddition && <Badge tone="accent">{u.label || "Adicional"}</Badge>}
                        </p>
                        <p className="max-w-64 truncate text-xs text-slate-500" title={u.fileName}>
                          {u.fileName}
                        </p>
                      </td>
                      <td className="px-3 py-3">v{u.version}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmt.format(u.rowsValid)}</td>
                      <td className="px-3 py-3">
                        {u.isAddition && u.status === "reemplazada" ? <Badge tone="neutral">Quitada del mes</Badge> : <Badge tone={STATUS_BADGE[u.status].tone}>{STATUS_BADGE[u.status].label}</Badge>}
                      </td>
                      <td className="px-3 py-3 text-xs whitespace-nowrap">
                        {u.createdBy}
                        <br />
                        {fmtDate(u.createdAt)}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-1">
                          {u.hasFile && (
                            <a href={`/api/cargas/${u.id}/archivo`} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" title="Descargar el Excel original">
                              <Download className="size-4" aria-label="Descargar el Excel original" />
                            </a>
                          )}
                          {u.isAddition && u.isCurrent && canRestore && (
                            <button
                              disabled={busy === u.id}
                              onClick={() => confirm(`¿Quitar "${u.label || "la base adicional"}" del análisis de ${monthLabel(u.month)}? Sus filas se conservan y se puede volver a sumar.`) && act(u.id, () => api.removeAddition(u.id))}
                              className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                            >
                              Quitar del mes
                            </button>
                          )}
                          {u.status === "reemplazada" && canRestore && (
                            <button
                              disabled={busy === u.id}
                              onClick={() =>
                                confirm(u.isAddition ? `¿Volver a sumar "${u.label || "la base adicional"}" a ${monthLabel(u.month)}?` : `¿Volver a dejar vigente la versión ${u.version} de ${monthLabel(u.month)}?`) &&
                                act(u.id, () => api.activateUpload(u.id))
                              }
                              className={`rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800 ${u.isAddition ? "px-2.5 py-1.5 text-xs font-medium" : "p-2"}`}
                              title={u.isAddition ? "Volver a sumar esta base al mes" : "Volver a esta versión"}
                            >
                              {u.isAddition ? "Volver a sumar" : <RotateCcw className="size-4" aria-label="Volver a esta versión" />}
                            </button>
                          )}
                          {(canRestore || !u.isCurrent) && (
                            <button
                              disabled={busy === u.id}
                              onClick={() => confirm(deleteMessage(u)) && act(u.id, () => (canRestore ? api.deleteUpload(u.id) : api.discardUpload(u.id)))}
                              className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/10"
                              title="Eliminar este archivo"
                            >
                              <Trash2 className="size-4" aria-label="Eliminar este archivo" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </Card>
  );
}

/* ---------- pantalla ---------- */

export function Upload() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const campaign: CampaignCode = isCampaignCode(params.get("campana") ?? "") ? (params.get("campana") as CampaignCode) : "tdc";
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000 });
  const uploads = useQuery({ queryKey: ["uploads", campaign], queryFn: () => api.uploads(campaign) });
  const canUpload = me.data?.permissions.includes("datos:cargar") ?? false;
  const canRestore = me.data?.permissions.includes("datos:restaurar") ?? false;

  const [phase, setPhase] = useState<Phase>({ name: "idle" });
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [month, setMonth] = useState(currentMonth());
  const [monthFromFile, setMonthFromFile] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const excelRef = useRef<ExcelReader | null>(null);

  // Al salir de la pantalla se cierra el lector y se libera su memoria.
  useEffect(() => () => excelRef.current?.close(), []);

  const closeReader = () => {
    excelRef.current?.close();
    excelRef.current = null;
  };

  const reset = () => {
    closeReader();
    setPhase({ name: "idle" });
    setAnalysis(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const chooseCampaign = (c: CampaignCode) => {
    reset();
    setParams({ campana: c }, { replace: true });
  };

  const readFile = useCallback(
    async (file: File) => {
      setError("");
      setAnalysis(null);
      if (!/\.(xlsx|xlsb|xls|csv)$/i.test(file.name)) {
        setError("Ese archivo no es un Excel. Usa .xlsx, .xlsb, .xls o .csv.");
        return;
      }
      // Un lector nuevo por archivo; el anterior se cierra y suelta su memoria.
      closeReader();
      const excel = new ExcelReader();
      excelRef.current = excel;
      const onStep = (step: string) => setPhase({ name: "reading", fileName: file.name, step });
      onStep("Abriendo el archivo…");
      try {
        const { result, sha } = await excel.open(file, campaign, onStep);
        setAnalysis({ ...result, file, sha });
        // Sin fechas en el archivo (las bases), el mes sale del nombre del archivo ("…Octubre…", "…Oct26…");
        // si tampoco lo dice, se pide elegirlo.
        const fromName = result.month ? null : monthFromName(file.name);
        setMonthFromFile(Boolean(fromName));
        setMonth(result.month?.month ?? fromName ?? "");
        setPhase({ name: "ready" });
      } catch (e) {
        if (e instanceof ReadCancelled) return;
        console.error(e);
        closeReader();
        setError(e instanceof Error ? e.message : "No pude leer el archivo.");
        setPhase({ name: "idle" });
      }
    },
    [campaign],
  );

  const changeType = async (datasetId: string) => {
    const prev = analysis;
    const excel = excelRef.current;
    if (!prev || !excel) return;
    setError("");
    const onStep = (step: string) => setPhase({ name: "reading", fileName: prev.file.name, step });
    onStep("Leyendo el archivo como " + datasetLabel(datasetId) + "…");
    try {
      const result = await excel.analyze(datasetId, onStep);
      setAnalysis({ ...result, file: prev.file, sha: prev.sha });
      setMonth(result.month?.month ?? month);
      setPhase({ name: "ready" });
    } catch (e) {
      if (e instanceof ReadCancelled) return;
      setError(e instanceof Error ? e.message : "No pude leer el archivo.");
      setPhase({ name: "ready" });
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && phase.name !== "saving") void readFile(file);
  };

  // Versión vigente "original" de ese archivo y mes (las bases adicionales no cuentan aquí).
  const current = useMemo(
    () => (analysis?.datasetId ? uploads.data?.find((u) => u.dataset === analysis.datasetId && u.month === month && u.isCurrent && !u.isAddition) : undefined),
    [analysis, uploads.data, month],
  );
  const isBase = analysis?.datasetId ? getCampaign(campaign).datasets.find((d) => d.id === analysis.datasetId)?.kind === "base" : false;
  // Dos bases muy parecidas (p. ej. Primeras y Segundas Cuentas de TDC): si ni las columnas ni el nombre del
  // archivo lo dejan claro, se pregunta en vez de adivinar.
  const kindOf = (id: string) => getCampaign(campaign).datasets.find((d) => d.id === id)?.kind;
  const [d0, d1] = analysis?.detections ?? [];
  const doubt = Boolean(d0 && d1 && kindOf(d0.datasetId) === "base" && kindOf(d1.datasetId) === "base" && d0.sheet === d1.sheet && d0.score - d1.score < 3);
  const [typeChosen, setTypeChosen] = useState(false);
  // Tipos ya guardados de este mismo archivo (un libro puede traer dos bases).
  const [savedHere, setSavedHere] = useState<Set<string>>(new Set());
  useEffect(() => setSavedHere(new Set()), [analysis?.sha]);
  useEffect(() => setTypeChosen(false), [analysis?.sha]);
  // Si ya hay base ese mes, hay que elegir: sumar como adicional o reemplazar.
  const needsMode = Boolean(isBase && current);
  const [mode, setMode] = useState<null | "adicional" | "reemplazar">(null);
  const [addLabel, setAddLabel] = useState("");
  useEffect(() => {
    setMode(null);
    setAddLabel(`Adicional ${new Intl.DateTimeFormat("es-SV", { day: "numeric", month: "short" }).format(new Date())}`);
  }, [analysis?.sha, analysis?.datasetId, month]);

  // Meses que trae el archivo según la fecha de cada fila: para no mezclar un mes con otro.
  const split = useMemo(() => (analysis ? rowsByMonth(analysis.rows) : { byMonth: {}, sinFecha: 0 }), [analysis]);
  const monthsInFile = Object.entries(split.byMonth).sort((x, y) => y[1] - x[1]);
  // En una base: cuántos clientes distintos trae (una fila por oferta o producto repite el NIU).
  const uniqueNius = useMemo(() => (analysis ? new Set(analysis.rows.map((r) => r.niu)).size : 0), [analysis]);
  const hasDates = monthsInFile.length > 0;
  const inMonth = (split.byMonth[month] ?? 0) + split.sinFecha;
  const outside = analysis ? analysis.rows.length - inMonth : 0;
  const [scope, setScope] = useState<"mes" | "todo">("mes");
  useEffect(() => setScope("mes"), [analysis?.sha, analysis?.datasetId]);
  // La sábana trae a propósito ventas de meses anteriores (cosecha): se guarda completa.
  const sabanaFile = analysis?.datasetId ? kindOf(analysis.datasetId) === "sabana" : false;
  const filtering = outside > 0 && scope === "mes" && !sabanaFile;

  // Sábana que reemplaza a la vigente del mes: se comparan antes de guardar por si viene incompleta.
  const vigente = useQuery({
    queryKey: ["resumen-sabana", current?.id ?? null],
    queryFn: () => api.sabanaSummary(current!.id),
    enabled: Boolean(sabanaFile && current),
  });
  const diff = useMemo(
    () => (sabanaFile && current && vigente.data && analysis && VALID_MONTH.test(month) ? compareSabanas(vigente.data, summarizeSales(analysis.rows, month), month) : null),
    [sabanaFile, current, vigente.data, analysis, month],
  );
  const [replaceAnyway, setReplaceAnyway] = useState(false);
  useEffect(() => setReplaceAnyway(false), [analysis?.sha, month]);
  const blockedIncomplete = Boolean(diff?.menos && !replaceAnyway);
  const toSave = filtering ? inMonth : (analysis?.rows.length ?? 0);
  const monthOk = VALID_MONTH.test(month);

  const save = async () => {
    if (!analysis?.datasetId) return;
    const a = analysis;
    // Solo las filas del mes elegido (salvo que se pida guardar todo el archivo en ese mes).
    const rows = filtering ? onlyMonth(a.rows, month) : a.rows;
    const ends = filtering ? chunkEnds(rows) : a.chunkEnds;
    const chunks = ends.map((end, i) => rows.slice(i ? ends[i - 1] : 0, end));
    const excluded = a.rows.length - rows.length;
    let uploadId: string | null = null;
    setError("");
    try {
      setPhase({ name: "saving", done: 0, total: rows.length, step: "Preparando la carga…" });
      const c = await api.createUpload({
        campaign,
        dataset: a.datasetId!,
        month,
        fileName: a.file.name,
        fileSha256: a.sha,
        rowsTotal: a.rows.length + a.dropped,
        rowsValid: rows.length,
        rowsDiscarded: a.dropped + excluded,
        ...(needsMode ? { mode: mode!, label: mode === "adicional" ? addLabel : null } : {}),
      });
      uploadId = c.id;
      let done = 0;
      for (let seq = 0; seq < chunks.length; seq++) {
        const part = chunks[seq]!;
        setPhase({ name: "saving", done, total: rows.length, step: `Guardando filas (${seq + 1} de ${chunks.length})…` });
        await withRetry(() => api.sendRows(c.id, seq, part));
        done += part.length;
      }
      let warning: string | undefined;
      if (a.file.size <= MAX_BACKUP_BYTES) {
        setPhase({ name: "saving", done, total: rows.length, step: "Guardando el Excel original como respaldo…" });
        try {
          await withRetry(() => api.putFile(c.id, a.file));
        } catch {
          warning = "Los datos quedaron guardados, pero no se pudo guardar una copia del Excel original.";
        }
      } else {
        warning = "El Excel pesa más de 60 MB: los datos quedaron guardados, pero no se guardó una copia del archivo original.";
      }
      setPhase({ name: "saving", done, total: rows.length, step: "Verificando y activando la versión…" });
      const { upload } = await api.confirmUpload(c.id);
      // La ficha del cliente también se arma con estos archivos: se vuelve a consultar.
      await Promise.all([qc.invalidateQueries({ queryKey: ["uploads"] }), qc.invalidateQueries({ queryKey: ["analysis"] }), qc.invalidateQueries({ queryKey: ["cliente"] })]);
      // Si el mismo libro trae otra base (p. ej. Primeras y Segundas), se ofrece guardarla sin volver a subirlo.
      const saved = new Set([...savedHere, a.datasetId!]);
      setSavedHere(saved);
      const others = [...new Set(a.hojas.flatMap((h) => h.tipos))].filter((t) => !saved.has(t) && kindOf(t) === "base");
      if (!others.length) closeReader(); // ya no hace falta el archivo en memoria
      setPhase({ name: "done", upload, warning, others });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo guardar.";
      setError(`${msg} No se activó nada: la versión vigente sigue igual.`);
      setPhase({ name: "ready" });
      if (uploadId) void api.discardUpload(uploadId).catch(() => {});
    }
  };

  const kind = analysis?.datasetId ? (getCampaign(campaign).datasets.find((d) => d.id === analysis.datasetId)?.kind as UploadKind) : null;

  return (
    <>
      <PageHeader
        title="Centro de carga"
        subtitle="Sábanas, bases, tipificaciones y ventas de cada mes. Cada carga es una versión nueva y la anterior queda de respaldo."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              to="/carga/metas"
              className="inline-flex items-center gap-2 rounded-full border border-hair bg-white px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-ink-faint dark:bg-slate-900"
            >
              <Target className="size-4 text-ink-soft" aria-hidden /> Metas y cumplimientos
            </Link>
            <Link
              to="/carga/zip"
              className="inline-flex items-center gap-2 rounded-full border border-hair bg-white px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-ink-faint dark:bg-slate-900"
            >
              <FileArchive className="size-4 text-ink-soft" aria-hidden /> Carga masiva
            </Link>
          </div>
        }
      />

      {/* Campaña */}
      <div role="tablist" aria-label="Campaña" className="mb-5 flex flex-wrap gap-2">
        {CAMPAIGNS.map((c) => (
          <button
            key={c.code}
            role="tab"
            aria-selected={c.code === campaign}
            onClick={() => chooseCampaign(c.code)}
            disabled={phase.name === "saving"}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors disabled:opacity-50 ${
              c.code === campaign ? "bg-brand-500 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-300 dark:ring-slate-700"
            }`}
          >
            {c.shortName}
          </button>
        ))}
      </div>

      {!canUpload && me.data && (
        <Card className="mb-6">
          <p className="text-sm text-slate-600">Tu usuario es de solo lectura: puedes ver el historial, pero no cargar archivos.</p>
        </Card>
      )}

      {canUpload && phase.name !== "done" && (
        <Card className="mb-6">
          {/* Zona para soltar */}
          {(phase.name === "idle" || (phase.name === "reading" && !analysis)) && (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => phase.name === "idle" && inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
                dragging ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-slate-300 hover:border-brand-500/60 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40"
              }`}
            >
              {phase.name === "reading" ? (
                <>
                  <LoaderCircle className="mb-3 size-10 animate-spin text-brand-500" aria-hidden />
                  <p className="font-medium break-all">{phase.fileName}</p>
                  <p className="mt-1 text-sm text-slate-500" aria-live="polite">
                    {phase.step}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">La pantalla sigue respondiendo. Si sales del Centro de carga, la lectura se cancela.</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      reset();
                    }}
                    className="mt-4 rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 ring-1 ring-slate-300 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"
                  >
                    Cancelar
                  </button>
                </>
              ) : (
                <>
                  <CloudUpload className="mb-3 size-10 text-brand-500" aria-hidden />
                  <p className="font-medium">Arrastra aquí el Excel de {getCampaign(campaign).shortName}</p>
                  <p className="mt-1 text-sm text-slate-500">o haz clic para elegirlo · .xlsx, .xlsb, .xls o .csv</p>
                  <p className="mt-4 max-w-lg text-xs text-slate-400">
                    Se reconoce solo: {getCampaign(campaign).datasets.map((d) => d.label).join(" · ")}
                  </p>
                </>
              )}
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void readFile(f);
                }}
              />
            </div>
          )}
          {error && phase.name === "idle" && <div className="mt-4"><ErrorMessage>{error}</ErrorMessage></div>}

          {/* Resultado de la lectura */}
          {analysis && (phase.name === "ready" || phase.name === "saving" || phase.name === "reading") && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-start gap-3">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10">
                    <FileSpreadsheet className="size-5" aria-hidden />
                  </div>
                  <div>
                    <p className="font-semibold">{analysis.file.name}</p>
                    <p className="text-sm text-slate-500">
                      {(analysis.file.size / 1024 / 1024).toFixed(1)} MB{analysis.sheet && ` · hoja ${analysis.sheet}`}
                    </p>
                  </div>
                </div>
                {phase.name === "ready" && (
                  <Button variant="secondary" onClick={reset}>
                    <X className="size-4" aria-hidden /> Elegir otro archivo
                  </Button>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="tipo" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Tipo de archivo
                  </label>
                  <select
                    id="tipo"
                    disabled={phase.name !== "ready"}
                    value={analysis.datasetId ?? ""}
                    onChange={(e) => {
                      setTypeChosen(true);
                      void changeType(e.target.value);
                    }}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    {!analysis.datasetId && <option value="">Elige el tipo…</option>}
                    {getCampaign(campaign).datasets.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label} — {d.source}
                        {analysis.detections[0]?.datasetId === d.id && !doubt ? "  ✓ reconocido" : ""}
                      </option>
                    ))}
                  </select>
                  {analysis.datasetId && analysis.detections[0]?.datasetId === analysis.datasetId && !doubt && (
                    <p className="mt-1.5 flex items-center gap-1 text-xs text-emerald-600">
                      <CircleCheck className="size-3.5" aria-hidden /> Reconocido automáticamente por sus columnas.
                    </p>
                  )}
                </div>
                <div>
                  <label htmlFor="mes" className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-200">
                    Mes al que corresponde
                  </label>
                  <input
                    id="mes"
                    type="month"
                    disabled={phase.name === "saving"}
                    value={month}
                    onChange={(e) => {
                      setMonth(e.target.value);
                      setMonthFromFile(false);
                    }}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                  {hasDates ? (
                    <p className="mt-1.5 text-xs text-slate-500">
                      Según las fechas del archivo: {monthLabel(monthsInFile[0]![0])} ({fmt.format(monthsInFile[0]![1])} filas).
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className={monthOk ? "" : "font-medium text-amber-700 dark:text-amber-300"}>
                        {monthOk && monthFromFile ? "Tomado del nombre del archivo; cámbialo si no es." : `Este archivo no trae fechas: ${monthOk ? "revisa que sea el mes correcto." : "elige de qué mes es."}`}
                      </span>
                      {[currentMonth(), previousMonth()].map((m) => (
                        <button
                          key={m}
                          type="button"
                          disabled={phase.name === "saving"}
                          onClick={() => {
                            setMonth(m);
                            setMonthFromFile(false);
                          }}
                          aria-pressed={month === m}
                          className={`rounded-full px-2.5 py-1 font-medium capitalize ring-1 transition-colors ${month === m ? "bg-brand-500 text-white ring-brand-500" : "text-slate-600 ring-slate-300 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800"}`}
                        >
                          {monthLabel(m)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {phase.name === "reading" ? null : analysis.error ? (
                <ErrorMessage>{analysis.error}</ErrorMessage>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Stat
                      label="Filas válidas"
                      value={fmt.format(analysis.rows.length)}
                      foot={analysis.sheet.includes(" + ") ? `De las hojas ${analysis.sheet.split(" + ").join(", ")}` : analysis.sheet ? `De la hoja ${analysis.sheet}` : undefined}
                    />
                    <Stat
                      label={kind === "tipif" ? "Descartadas (sin fecha)" : "Descartadas (sin NIU)"}
                      value={fmt.format(analysis.dropped)}
                      tone={analysis.dropped ? "warn" : "default"}
                    />
                    {isBase ? (
                      <Stat
                        label="Clientes únicos"
                        value={fmt.format(uniqueNius)}
                        foot={analysis.rows.length > uniqueNius ? `${fmt.format(analysis.rows.length - uniqueNius)} filas repiten un NIU que ya viene en el archivo` : "Ningún NIU repetido"}
                      />
                    ) : (
                      <Stat label="Meses en el archivo" value={String(monthsInFile.length || "—")} foot={monthsInFile.slice(0, 3).map(([m, n]) => `${monthLabel(m)}: ${fmt.format(n)}`).join(" · ") || "Sin fechas"} />
                    )}
                  </div>

                  {doubt && !typeChosen && d0 && d1 && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                      <p className="font-medium">¿Cuál base es esta?</p>
                      <p className="mt-0.5 text-amber-800 dark:text-amber-200">Las columnas y el nombre del archivo sirven para las dos. Elige una para guardarla en su lugar.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {[d0, d1].map((d) => (
                          <button
                            key={d.datasetId}
                            type="button"
                            onClick={() => {
                              setTypeChosen(true);
                              if (d.datasetId !== analysis.datasetId) void changeType(d.datasetId);
                            }}
                            className="rounded-xl bg-white px-3.5 py-2 font-medium text-ink ring-1 ring-amber-300 hover:ring-amber-500 dark:bg-slate-900 dark:ring-amber-500/40"
                          >
                            {datasetLabel(d.datasetId)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {analysis.hojas.length > 1 && (
                    <div className="rounded-xl border border-slate-200 px-4 py-3 text-sm dark:border-slate-800">
                      <p className="mb-2 text-xs font-medium text-slate-500">Hojas del archivo</p>
                      <ul className="space-y-1.5">
                        {analysis.hojas.map((h) => {
                          const now = analysis.sheet.split(" + ").includes(h.name);
                          const inside = analysis.covered.includes(h.name);
                          const other = h.tipos.find((t) => t !== analysis.datasetId);
                          return (
                            <li key={h.name} className="flex flex-wrap items-baseline gap-x-2">
                              <span className={now ? "font-medium text-slate-800 dark:text-slate-100" : "text-slate-600 dark:text-slate-300"}>{h.name}</span>
                              {h.rows !== null && <span className="text-xs text-slate-400 tabular-nums">≈ {fmt.format(Math.max(0, h.rows - 1))} filas</span>}
                              <span className="text-xs text-slate-500">
                                {now
                                  ? `→ se guarda ahora como ${datasetLabel(analysis.datasetId!)}`
                                  : inside
                                    ? `→ sus clientes ya vienen en «${analysis.sheet}»: no se suman, se anota en qué carga venía cada uno`
                                  : other
                                    ? `→ es ${datasetLabel(other)}: después vuelve a subir el archivo y elige ese tipo`
                                    : "→ no se usa"}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                  {monthOk && hasDates && inMonth === split.sinFecha && (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                      <TriangleAlert className="size-4 shrink-0" aria-hidden />
                      <span className="flex-1">
                        Este archivo no tiene filas de {monthLabel(month)}: sus fechas son de {monthLabel(monthsInFile[0]![0])}.
                      </span>
                      <button type="button" onClick={() => setMonth(monthsInFile[0]![0])} className="rounded-lg px-2.5 py-1 font-medium ring-1 ring-amber-300 hover:bg-amber-100 dark:ring-amber-500/40 dark:hover:bg-amber-500/20">
                        Usar {monthLabel(monthsInFile[0]![0])}
                      </button>
                    </div>
                  )}
                  {monthOk && sabanaFile && outside > 0 && inMonth > split.sinFecha && (
                    <p className="flex gap-2 rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
                      <CircleCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <span>
                        Trae ventas de otros meses (cosecha): {monthsInFile.filter(([m]) => m !== month).map(([m, n]) => `${monthLabel(m)}: ${fmt.format(n)}`).join(" · ")}. Se guarda toda la sábana:
                        lo que el banco entregó, aplicó o activó en {monthLabel(month)} cuenta para su meta, y lo que ya contó en un mes anterior no se repite.
                      </span>
                    </p>
                  )}
                  {monthOk && !sabanaFile && outside > 0 && inMonth > split.sinFecha && (
                    <fieldset className="rounded-2xl border border-amber-200 p-4 dark:border-amber-500/30">
                      <legend className="px-1 text-sm font-semibold">
                        El archivo trae filas de otros meses ({monthsInFile.filter(([m]) => m !== month).map(([m, n]) => `${monthLabel(m)}: ${fmt.format(n)}`).join(" · ")})
                      </legend>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {(
                          [
                            ["mes", `Guardar solo las de ${monthLabel(month)}`, `${fmt.format(inMonth)} filas. Las ${fmt.format(outside)} de otros meses quedan fuera y no se mezclan con ${monthLabel(month)}.`],
                            ["todo", `Guardar todo el archivo en ${monthLabel(month)}`, `${fmt.format(analysis.rows.length)} filas. Úsalo solo si esas filas de otros meses sí cuentan en ${monthLabel(month)}.`],
                          ] as const
                        ).map(([value, title, hint]) => (
                          <label
                            key={value}
                            className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 text-sm transition-colors ${
                              scope === value ? "border-brand-500 bg-brand-50/60 dark:bg-brand-500/10" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
                            }`}
                          >
                            <input type="radio" name="alcance" className="mt-0.5 accent-brand-500" checked={scope === value} onChange={() => setScope(value)} />
                            <span>
                              <span className="block font-medium first-letter:uppercase">{title}</span>
                              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{hint}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
                  {needsMode && current && !(doubt && !typeChosen) && (
                    <fieldset className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
                      <legend className="px-1 text-sm font-semibold">
                        <span className="capitalize">{monthLabel(month)}</span> ya tiene esta base ({fmt.format(current.rowsValid)} clientes, cargada el {fmtDate(current.createdAt)})
                      </legend>
                      <div className="mt-2 grid gap-3 sm:grid-cols-2">
                        {(
                          [
                            ["adicional", "Agregar como base adicional", "El banco mandó más clientes: se suman a la base del mes y se ve cuánto rinde cada base."],
                            ["reemplazar", "Reemplazar la base del mes", "La base anterior venía mal: esta toma su lugar (la anterior queda como respaldo)."],
                          ] as const
                        ).map(([value, title, hint]) => (
                          <label
                            key={value}
                            className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 text-sm transition-colors ${
                              mode === value ? "border-brand-500 bg-brand-50/60 dark:bg-brand-500/10" : "border-slate-200 hover:border-slate-300 dark:border-slate-700"
                            }`}
                          >
                            <input type="radio" name="modo" className="mt-0.5 accent-brand-500" checked={mode === value} onChange={() => setMode(value)} />
                            <span>
                              <span className="block font-medium">{title}</span>
                              <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">{hint}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                      {mode === "adicional" && (
                        <label className="mt-3 block max-w-sm text-sm">
                          <span className="mb-1.5 block text-slate-600 dark:text-slate-300">Nombre de esta base</span>
                          <input
                            value={addLabel}
                            maxLength={60}
                            onChange={(e) => setAddLabel(e.target.value)}
                            className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                          />
                        </label>
                      )}
                    </fieldset>
                  )}
                  {diff && current && (
                    <div
                      className={`rounded-2xl border p-4 text-sm ${
                        diff.menos ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100" : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100"
                      }`}
                    >
                      <p className="font-medium">
                        {diff.menos
                          ? `Esta sábana trae menos que la vigente de ${monthLabel(month)}: puede venir incompleta`
                          : `Trae todo lo de la sábana vigente de ${monthLabel(month)}${diff.puntos.some((x) => x.antes !== x.ahora) ? " y más" : ""}`}
                      </p>
                      <table className="mt-3 w-full max-w-xl text-[13px]">
                        <thead>
                          <tr className="text-left text-xs opacity-70">
                            <th className="py-1 font-normal" />
                            <th className="py-1 text-right font-normal">Vigente (cargada el {fmtDate(current.createdAt)})</th>
                            <th className="py-1 text-right font-normal">Nueva</th>
                          </tr>
                        </thead>
                        <tbody>
                          {diff.puntos.map((x) => {
                            const show = (v: string | number) => (typeof v === "number" ? fmt.format(v) : /^\d{4}-\d{2}-\d{2}$/.test(v) ? dayLabel(v) : v);
                            const que = x.que.startsWith("Cosecha de ") ? `Cosecha de ${monthLabel(x.que.slice(11))}` : x.que;
                            return (
                              <tr key={x.que} className={x.menos ? "font-medium" : ""}>
                                <td className="py-1 pr-3">{que}</td>
                                <td className="py-1 text-right tabular-nums">{show(x.antes)}</td>
                                <td className="py-1 text-right tabular-nums">
                                  {show(x.ahora)}
                                  {x.menos && <span aria-hidden> ↓</span>}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {diff.menos ? (
                        <label className="mt-3 flex cursor-pointer items-start gap-2">
                          <input type="checkbox" className="mt-0.5 accent-amber-600" checked={replaceAnyway} onChange={(e) => setReplaceAnyway(e.target.checked)} />
                          <span>Sí, reemplazar de todos modos. La vigente queda de respaldo y puedes volver a ella desde el historial.</span>
                        </label>
                      ) : (
                        <p className="mt-3 text-[13px]">Al guardar, el cumplimiento, el MTD, el ritmo y la proyección se recalculan con el nuevo corte.</p>
                      )}
                    </div>
                  )}
                  {current && !needsMode && !diff && (
                    <p className="flex gap-2 rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <span>
                        <span className="capitalize">{monthLabel(month)}</span> ya tiene este archivo vigente (v{current.version}, {fmt.format(current.rowsValid)} filas, cargado por {current.createdBy} el{" "}
                        {fmtDate(current.createdAt)}). Al guardar, el nuevo queda vigente y el anterior se conserva como respaldo.
                      </span>
                    </p>
                  )}
                  {analysis.missingOptional.length > 0 && (
                    <details className="text-xs text-slate-500">
                      <summary className="cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-300">
                        Este archivo no trae {analysis.missingOptional.length} columnas opcionales (no impiden guardarlo)
                      </summary>
                      <p className="mt-1.5 leading-relaxed">{analysis.missingOptional.join(" · ")}</p>
                    </details>
                  )}

                  {kind && analysis.datasetId && <Preview rows={analysis.rows} kind={kind} datasetId={analysis.datasetId} />}
                  <p className="-mt-2 text-xs text-slate-400">Primeras 8 filas, ya como quedarán guardadas.</p>
                </>
              )}

              {error && <ErrorMessage>{error}</ErrorMessage>}

              {phase.name === "reading" ? (
                <p className="flex items-center gap-2 text-sm text-slate-500" aria-live="polite">
                  <LoaderCircle className="size-4 animate-spin text-brand-500" aria-hidden /> {phase.step}
                </p>
              ) : phase.name === "saving" ? (
                <div>
                  <div className="mb-2 flex justify-between text-sm">
                    <span className="font-medium">{phase.step}</span>
                    <span className="text-slate-500 tabular-nums">
                      {fmt.format(phase.done)} / {fmt.format(phase.total)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                    <div className="h-full rounded-full bg-brand-500 transition-all" style={{ width: `${phase.total ? (phase.done / phase.total) * 100 : 0}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">No cierres esta pestaña hasta que termine.</p>
                </div>
              ) : (
                !analysis.error && (
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={save} disabled={!monthOk || toSave === 0 || (needsMode && !mode) || (doubt && !typeChosen) || blockedIncomplete}>
                      <CloudUpload className="size-4" aria-hidden />{" "}
                      {!monthOk
                        ? "Guardar"
                        : needsMode && mode === "adicional"
                          ? `Sumar ${fmt.format(toSave)} clientes a ${monthLabel(month)}`
                          : `Guardar ${fmt.format(toSave)} filas en ${monthLabel(month)}`}
                    </Button>
                    {doubt && !typeChosen && <span className="self-center text-xs text-slate-500">Elige cuál base es.</span>}
                    {blockedIncomplete && <span className="self-center text-xs text-slate-500">Confirma arriba si quieres reemplazar la sábana vigente.</span>}
                    {!(doubt && !typeChosen) && !monthOk && <span className="self-center text-xs text-slate-500">Elige el mes al que corresponde.</span>}
                    {monthOk && needsMode && !mode && <span className="self-center text-xs text-slate-500">Elige si es una base adicional o un reemplazo.</span>}
                  </div>
                )
              )}
            </div>
          )}
        </Card>
      )}

      {phase.name === "done" && (
        <Card className="mb-6 border-emerald-200 dark:border-emerald-500/30">
          <div className="flex items-start gap-3">
            <CircleCheck className="mt-0.5 size-6 shrink-0 text-emerald-600" aria-hidden />
            <div className="flex-1">
              <p className="font-semibold">
                {phase.upload.isAddition
                  ? `Listo: "${phase.upload.label || "Base adicional"}" se sumó a la base de ${monthLabel(phase.upload.month)}`
                  : `Listo: ${datasetLabel(phase.upload.dataset)} de ${monthLabel(phase.upload.month)} quedó vigente`}
              </p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Versión {phase.upload.version} · {fmt.format(phase.upload.rowsValid)} filas guardadas y verificadas
                {phase.upload.rowsDiscarded ? ` · ${fmt.format(phase.upload.rowsDiscarded)} descartadas` : ""}.
              </p>
              {phase.warning && <p className="mt-2 text-sm text-amber-700">{phase.warning}</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                {phase.others?.map((t) => (
                  <Button
                    key={t}
                    onClick={() => {
                      setTypeChosen(true);
                      void changeType(t);
                    }}
                  >
                    Guardar también la {datasetLabel(t)} de este archivo
                  </Button>
                ))}
                <Button variant={phase.others?.length ? "secondary" : undefined} onClick={reset}>
                  Cargar otro archivo
                </Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <History campaign={campaign} canRestore={canRestore} />
    </>
  );
}
