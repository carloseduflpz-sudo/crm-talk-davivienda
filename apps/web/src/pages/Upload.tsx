/* Centro de carga: arrastrar el Excel → la app lo reconoce y lo valida → vista previa →
   se guarda por lotes con versión, sin borrar la versión anterior. */
import { CAMPAIGNS, PREVIEW_HIDDEN, getCampaign, isCampaignCode, type CampaignCode, type ExcelReading, type NormalizedRow, type UploadKind } from "@crm/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, CloudUpload, Download, FileSpreadsheet, LoaderCircle, RotateCcw, Trash2, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router";
import { Button, ErrorMessage } from "../components/form";
import { Badge, Card, PageHeader } from "../components/ui";
import { ApiError, api, type UploadInfo } from "../lib/api";
import { ExcelReader, ReadCancelled } from "../lib/excel";
import { monthLabel } from "../lib/xlsx";

const ACCEPT = ".xlsx,.xlsb,.xls,.csv";
const MAX_BACKUP_BYTES = 60 * 1024 * 1024;

/** Lo que devolvió el lector en segundo plano, más el archivo y su huella. */
interface Analysis extends ExcelReading {
  file: File;
  sha: string;
}

type Phase = { name: "idle" } | { name: "reading"; fileName: string; step: string } | { name: "ready" } | { name: "saving"; done: number; total: number; step: string } | { name: "done"; upload: UploadInfo; warning?: string };

const fmt = new Intl.NumberFormat("es-SV");
const fmtDate = (ms: number) => new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
const currentMonth = () => new Date().toISOString().slice(0, 7);
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
  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id);
    setError("");
    try {
      await fn();
      await Promise.all([qc.invalidateQueries({ queryKey: ["uploads"] }), qc.invalidateQueries({ queryKey: ["analysis"] })]);
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
        {uploads.data && <span className="text-sm text-slate-500">{uploads.data.length === 1 ? "1 versión" : `${uploads.data.length} versiones`}</span>}
      </div>
      {error && <div className="px-5 pt-4"><ErrorMessage>{error}</ErrorMessage></div>}
      {uploads.isPending && <p className="p-5 text-sm text-slate-500">Cargando historial…</p>}
      {uploads.isError && <p className="p-5 text-sm text-red-600">{uploads.error.message}</p>}
      {uploads.data?.length === 0 && <p className="p-5 text-sm text-slate-500">Todavía no hay archivos cargados para esta campaña.</p>}
      {!!uploads.data?.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-slate-500 uppercase">
              <tr className="border-b border-slate-200 dark:border-slate-800">
                <th className="px-5 py-2.5 font-semibold">Archivo</th>
                <th className="px-3 py-2.5 font-semibold">Mes</th>
                <th className="px-3 py-2.5 font-semibold">Versión</th>
                <th className="px-3 py-2.5 text-right font-semibold">Filas</th>
                <th className="px-3 py-2.5 font-semibold">Estado</th>
                <th className="px-3 py-2.5 font-semibold">Cargado</th>
                <th className="px-5 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {uploads.data.map((u) => (
                <tr key={u.id} className={u.isCurrent ? "" : "text-slate-500"}>
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-800 dark:text-slate-200">{datasetLabel(u.dataset)}</p>
                    <p className="max-w-64 truncate text-xs text-slate-500" title={u.fileName}>
                      {u.fileName}
                    </p>
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap capitalize">{monthLabel(u.month)}</td>
                  <td className="px-3 py-3">v{u.version}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmt.format(u.rowsValid)}</td>
                  <td className="px-3 py-3">
                    <Badge tone={STATUS_BADGE[u.status].tone}>{STATUS_BADGE[u.status].label}</Badge>
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
                      {u.status === "reemplazada" && canRestore && (
                        <button
                          disabled={busy === u.id}
                          onClick={() => confirm(`¿Volver a dejar vigente la versión ${u.version} de ${monthLabel(u.month)}?`) && act(u.id, () => api.activateUpload(u.id))}
                          className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
                          title="Volver a esta versión"
                        >
                          <RotateCcw className="size-4" aria-label="Volver a esta versión" />
                        </button>
                      )}
                      {!u.isCurrent && (
                        <button
                          disabled={busy === u.id}
                          onClick={() => confirm(`¿Descartar la versión ${u.version}? Sus filas se borran de la base.`) && act(u.id, () => api.discardUpload(u.id))}
                          className="rounded-lg p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-500/10"
                          title="Descartar"
                        >
                          <Trash2 className="size-4" aria-label="Descartar" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
        setMonth(result.month?.month ?? currentMonth());
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

  const current = useMemo(
    () => (analysis?.datasetId ? uploads.data?.find((u) => u.dataset === analysis.datasetId && u.month === month && u.isCurrent) : undefined),
    [analysis, uploads.data, month],
  );

  const save = async () => {
    if (!analysis?.datasetId) return;
    const a = analysis;
    const chunks = a.chunkEnds.map((end, i) => a.rows.slice(i ? a.chunkEnds[i - 1] : 0, end));
    let uploadId: string | null = null;
    setError("");
    try {
      setPhase({ name: "saving", done: 0, total: a.rows.length, step: "Preparando la carga…" });
      const c = await api.createUpload({
        campaign,
        dataset: a.datasetId!,
        month,
        fileName: a.file.name,
        fileSha256: a.sha,
        rowsTotal: a.rows.length + a.dropped,
        rowsValid: a.rows.length,
        rowsDiscarded: a.dropped,
      });
      uploadId = c.id;
      let done = 0;
      for (let seq = 0; seq < chunks.length; seq++) {
        const part = chunks[seq]!;
        setPhase({ name: "saving", done, total: a.rows.length, step: `Guardando filas (${seq + 1} de ${chunks.length})…` });
        await withRetry(() => api.sendRows(c.id, seq, part));
        done += part.length;
      }
      let warning: string | undefined;
      if (a.file.size <= MAX_BACKUP_BYTES) {
        setPhase({ name: "saving", done, total: a.rows.length, step: "Guardando el Excel original como respaldo…" });
        try {
          await withRetry(() => api.putFile(c.id, a.file));
        } catch {
          warning = "Los datos quedaron guardados, pero no se pudo guardar una copia del Excel original.";
        }
      } else {
        warning = "El Excel pesa más de 60 MB: los datos quedaron guardados, pero no se guardó una copia del archivo original.";
      }
      setPhase({ name: "saving", done, total: a.rows.length, step: "Verificando y activando la versión…" });
      const { upload } = await api.confirmUpload(c.id);
      await Promise.all([qc.invalidateQueries({ queryKey: ["uploads"] }), qc.invalidateQueries({ queryKey: ["analysis"] })]);
      closeReader(); // ya no hace falta el archivo en memoria
      setPhase({ name: "done", upload, warning });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "No se pudo guardar.";
      setError(`${msg} No se activó nada: la versión vigente sigue igual.`);
      setPhase({ name: "ready" });
      if (uploadId) void api.discardUpload(uploadId).catch(() => {});
    }
  };

  const kind = analysis?.datasetId ? (getCampaign(campaign).datasets.find((d) => d.id === analysis.datasetId)?.kind as UploadKind) : null;
  const byMonth = analysis?.month ? Object.entries(analysis.month.byMonth).sort((x, y) => y[1] - x[1]) : [];

  return (
    <>
      <PageHeader title="Centro de carga" subtitle="Sábanas, bases, tipificaciones y ventas de cada mes. Nada se borra: cada carga es una versión nueva." />

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
                    onChange={(e) => void changeType(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900"
                  >
                    {!analysis.datasetId && <option value="">Elige el tipo…</option>}
                    {getCampaign(campaign).datasets.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.label} — {d.source}
                        {analysis.detections[0]?.datasetId === d.id ? "  ✓ reconocido" : ""}
                      </option>
                    ))}
                  </select>
                  {analysis.datasetId && analysis.detections[0]?.datasetId === analysis.datasetId && (
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
                    onChange={(e) => setMonth(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm dark:border-slate-700 dark:bg-slate-900"
                  />
                  {analysis.month && (
                    <p className="mt-1.5 text-xs text-slate-500">
                      Sugerido: <span className="capitalize">{monthLabel(analysis.month.month)}</span> ({Math.round(analysis.month.share * 100)}% de las filas).
                    </p>
                  )}
                </div>
              </div>

              {phase.name === "reading" ? null : analysis.error ? (
                <ErrorMessage>{analysis.error}</ErrorMessage>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Stat label="Filas válidas" value={fmt.format(analysis.rows.length)} />
                    <Stat
                      label={kind === "tipif" ? "Descartadas (sin fecha)" : "Descartadas (sin NIU)"}
                      value={fmt.format(analysis.dropped)}
                      tone={analysis.dropped ? "warn" : "default"}
                    />
                    <Stat label="Meses en el archivo" value={String(byMonth.length || "—")} foot={byMonth.slice(0, 3).map(([m, n]) => `${monthLabel(m)}: ${fmt.format(n)}`).join(" · ")} />
                  </div>

                  {analysis.month && analysis.month.share < 0.8 && (
                    <p className="flex gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
                      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                      El archivo mezcla varios meses. Revisa que el mes elegido sea el correcto.
                    </p>
                  )}
                  {current && (
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
                    <Button onClick={save} disabled={!/^20\d{2}-\d{2}$/.test(month)}>
                      <CloudUpload className="size-4" aria-hidden /> Guardar {fmt.format(analysis.rows.length)} filas en {monthLabel(month)}
                    </Button>
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
              <p className="font-semibold">Listo: {datasetLabel(phase.upload.dataset)} de {monthLabel(phase.upload.month)} quedó vigente</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Versión {phase.upload.version} · {fmt.format(phase.upload.rowsValid)} filas guardadas y verificadas
                {phase.upload.rowsDiscarded ? ` · ${fmt.format(phase.upload.rowsDiscarded)} descartadas` : ""}.
              </p>
              {phase.warning && <p className="mt-2 text-sm text-amber-700">{phase.warning}</p>}
              <div className="mt-4">
                <Button onClick={reset}>Cargar otro archivo</Button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <History campaign={campaign} canRestore={canRestore} />
    </>
  );
}
