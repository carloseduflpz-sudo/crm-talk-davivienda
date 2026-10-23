/* Carga histórica: un ZIP con las tipificaciones de varios meses y campañas. Se reconoce cada archivo,
   se reparte cada llamada a su mes según su fecha y cada campaña × mes queda como una carga normal
   (con versión, respaldo y todo lo demás). */
import {
  CAMPAIGNS,
  chunkEnds,
  getCampaign,
  guessCampaign,
  isSheetFile,
  listZip,
  planBulk,
  readZipEntry,
  rowMonth,
  rowsByMonth,
  unitKey,
  type BulkUnit,
  type CampaignCode,
  type NormalizedRow,
  type ZipEntry,
} from "@crm/core";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleCheck, CloudUpload, FileArchive, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link } from "react-router";
import { Button, ErrorMessage } from "../components/form";
import { Card, PageHeader } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { ExcelReader, ReadCancelled } from "../lib/excel";
import { monthLabel } from "../lib/xlsx";

const fmt = new Intl.NumberFormat("es-SV");
/** Más allá de esto conviene avisar por el límite diario del plan gratuito de Cloudflare. */
const FREE_DAILY_ROWS = 100_000;

type FileStatus = "pendiente" | "leyendo" | "listo" | "otro-tipo" | "error" | "no-excel";
interface Row {
  entry: ZipEntry;
  campaign: CampaignCode | null;
  status: FileStatus;
  byMonth: Record<string, number>;
  rows: number;
  dropped: number;
  sha: string;
  note: string;
}
type UnitStatus = { state: "pendiente" | "guardando" | "listo" | "error" | "saltado"; done: number; message?: string };
type Phase = "idle" | "listing" | "listed" | "scanning" | "planned" | "uploading" | "done" | "stopped";

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      const retryable = !(e instanceof ApiError) || (e.status >= 500 && e.data.code !== "limite_cloudflare");
      if (!retryable || i >= tries) throw e;
      await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
}

/** Lee un archivo del ZIP como tipificaciones de esa campaña. */
async function readCalls(zip: File, row: Row, onStep: (s: string) => void): Promise<{ rows: NormalizedRow[]; sha: string; datasetId: string | null; dropped: number; error: string | null }> {
  const bytes = await readZipEntry(zip, row.entry);
  const reader = new ExcelReader();
  try {
    const { result, sha } = await reader.open(new File([bytes as BlobPart], row.entry.name), row.campaign!, onStep);
    return { rows: result.rows, sha, datasetId: result.datasetId, dropped: result.dropped, error: result.error };
  } finally {
    reader.close();
  }
}

export function BulkUpload() {
  const qc = useQueryClient();
  const [zip, setZip] = useState<File | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [replace, setReplace] = useState(false);
  const [unitStatus, setUnitStatus] = useState<Record<string, UnitStatus>>({});
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);

  // Mientras guarda, salir de la página cortaría la carga: se pide confirmar.
  useEffect(() => {
    if (phase !== "uploading" && phase !== "scanning") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [phase]);

  const open = async (file: File) => {
    setError("");
    if (!/\.zip$/i.test(file.name)) {
      setError("Ese archivo no es un ZIP. Para un solo Excel usa el Centro de carga.");
      return;
    }
    setPhase("listing");
    try {
      const entries = await listZip(file);
      setZip(file);
      setRows(
        entries.map((entry) => ({
          entry,
          campaign: guessCampaign(entry.path),
          status: isSheetFile(entry.name) ? "pendiente" : "no-excel",
          byMonth: {},
          rows: 0,
          dropped: 0,
          sha: "",
          note: "",
        })),
      );
      setUnitStatus({});
      setPhase("listed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pude abrir el ZIP.");
      setPhase("idle");
    }
  };

  const sheets = rows.filter((r) => r.status !== "no-excel");
  const missingCampaign = sheets.some((r) => !r.campaign);
  const setCampaign = (i: number, c: CampaignCode | null) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, campaign: c, status: r.status === "no-excel" ? r.status : "pendiente", byMonth: {}, rows: 0 } : r)));

  /* Paso 1: leer cada archivo y ver de qué meses trae llamadas. */
  const scan = async () => {
    if (!zip) return;
    cancelled.current = false;
    setPhase("scanning");
    setError("");
    // Qué campaña × mes ya tiene tipificaciones vigentes.
    try {
      const lists = await Promise.all(CAMPAIGNS.map((c) => api.uploads(c.code)));
      setExisting(new Set(lists.flat().filter((u) => u.isCurrent && u.kind === "tipif").map((u) => unitKey(u.campaign, u.month))));
    } catch {
      /* sin la lista se trata todo como nuevo; el servidor igual guarda versiones */
    }
    const next = [...rows];
    for (let i = 0; i < next.length; i++) {
      if (cancelled.current) break;
      const r = next[i]!;
      if (r.status === "no-excel" || r.status === "listo") continue;
      next[i] = { ...r, status: "leyendo" };
      setRows([...next]);
      try {
        const res = await readCalls(zip, r, (s) => setStep(`${r.entry.name}: ${s}`));
        if (!res.datasetId?.endsWith(":tipif")) {
          next[i] = { ...r, status: "otro-tipo", note: res.datasetId ? `Es ${getCampaign(r.campaign!).datasets.find((d) => d.id === res.datasetId)?.label ?? res.datasetId}: súbelo en el Centro de carga.` : "No parece de tipificaciones (VICI)." };
        } else {
          const by = rowsByMonth(res.rows);
          next[i] = { ...r, status: "listo", byMonth: by.byMonth, rows: res.rows.length, dropped: res.dropped, sha: res.sha, note: by.sinFecha ? `${fmt.format(by.sinFecha)} sin fecha` : "" };
        }
      } catch (e) {
        if (e instanceof ReadCancelled) break;
        next[i] = { ...r, status: "error", note: e instanceof Error ? e.message : "No se pudo leer." };
      }
      setRows([...next]);
    }
    setStep("");
    setPhase("planned");
  };

  const plan = useMemo(
    () =>
      planBulk(
        rows.flatMap((r, index) => (r.status === "listo" && r.campaign ? [{ index, campaign: r.campaign, byMonth: r.byMonth }] : [])),
        existing,
        replace,
      ),
    [rows, existing, replace],
  );
  const toUpload = plan.filter((u) => u.upload);
  const totalRows = toUpload.reduce((s, u) => s + u.rows, 0);

  /* Paso 2: guardar cada campaña × mes. Cada archivo se vuelve a leer una vez y sus meses se guardan en cuanto
     están completos (si un mes viene en varios archivos, se espera al último). */
  const upload = async () => {
    if (!zip) return;
    cancelled.current = false;
    setPhase("uploading");
    setError("");
    const status: Record<string, UnitStatus> = {};
    for (const u of plan) status[unitKey(u.campaign, u.month)] = { state: u.upload ? "pendiente" : "saltado", done: 0 };
    setUnitStatus({ ...status });
    const set = (k: string, s: UnitStatus) => {
      status[k] = s;
      setUnitStatus({ ...status });
    };

    const remaining = new Map(toUpload.map((u) => [unitKey(u.campaign, u.month), new Set(u.files)]));
    const acc = new Map<string, NormalizedRow[]>();
    const fileOrder = [...new Set(toUpload.flatMap((u) => u.files))].sort((a, b) => a - b);
    let stopped = false;

    const save = async (u: BulkUnit, data: NormalizedRow[]) => {
      const k = unitKey(u.campaign, u.month);
      const names = u.files.map((i) => rows[i]!.entry.name);
      set(k, { state: "guardando", done: 0 });
      let id: string | null = null;
      try {
        const c = await withRetry(() =>
          api.createUpload({
            campaign: u.campaign,
            dataset: `${u.campaign}:tipif`,
            month: u.month,
            fileName: `${zip.name} › ${names[0]}${names.length > 1 ? ` y ${names.length - 1} más` : ""}`.slice(0, 290),
            fileSha256: rows[u.files[0]!]!.sha,
            rowsTotal: data.length,
            rowsValid: data.length,
            rowsDiscarded: 0,
          }),
        );
        id = c.id;
        const ends = chunkEnds(data);
        let done = 0;
        for (let seq = 0; seq < ends.length; seq++) {
          if (cancelled.current) throw new ReadCancelled();
          const part = data.slice(seq ? ends[seq - 1] : 0, ends[seq]);
          await withRetry(() => api.sendRows(c.id, seq, part));
          done += part.length;
          set(k, { state: "guardando", done });
        }
        await withRetry(() => api.confirmUpload(c.id));
        set(k, { state: "listo", done: data.length });
      } catch (e) {
        if (id) void api.discardUpload(id).catch(() => {});
        const limit = e instanceof ApiError && e.data.code === "limite_cloudflare";
        if (limit || e instanceof ReadCancelled) stopped = true;
        set(k, {
          state: "error",
          done: 0,
          message: e instanceof ReadCancelled ? "Detenido" : limit ? "Cloudflare llegó a su límite del día" : e instanceof Error ? e.message : "No se pudo guardar.",
        });
        if (limit) setError("Cloudflare llegó al límite de escrituras del día. Lo que ya quedó guardado no se pierde: vuelve a cargar el mismo ZIP mañana y se saltan solos los meses que ya estén.");
      }
    };

    for (const fi of fileOrder) {
      if (stopped || cancelled.current) break;
      const r = rows[fi]!;
      setStep(`Leyendo ${r.entry.name}…`);
      let data: NormalizedRow[];
      try {
        data = (await readCalls(zip, r, (s) => setStep(`${r.entry.name}: ${s}`))).rows;
      } catch (e) {
        for (const u of toUpload) if (u.files.includes(fi)) set(unitKey(u.campaign, u.month), { state: "error", done: 0, message: e instanceof Error ? e.message : "No se pudo leer." });
        continue;
      }
      const byMonth = new Map<string, NormalizedRow[]>();
      for (const row of data) {
        const m = rowMonth(row);
        if (!m) continue;
        const list = byMonth.get(m);
        if (list) list.push(row);
        else byMonth.set(m, [row]);
      }
      for (const [m, list] of byMonth) {
        const k = unitKey(r.campaign!, m);
        const left = remaining.get(k);
        if (!left || status[k]?.state === "error") continue;
        const merged = acc.get(k);
        if (merged) merged.push(...list);
        else acc.set(k, list);
        left.delete(fi);
        if (left.size === 0) {
          setStep(`Guardando ${getCampaign(r.campaign!).shortName} de ${monthLabel(m)}…`);
          await save(toUpload.find((u) => unitKey(u.campaign, u.month) === k)!, acc.get(k)!);
          acc.delete(k);
          if (stopped || cancelled.current) break;
        }
      }
    }
    setStep("");
    await Promise.all([qc.invalidateQueries({ queryKey: ["uploads"] }), qc.invalidateQueries({ queryKey: ["analysis"] }), qc.invalidateQueries({ queryKey: ["cliente"] })]);
    setPhase(stopped || cancelled.current ? "stopped" : "done");
  };

  const reset = () => {
    cancelled.current = true;
    setZip(null);
    setRows([]);
    setUnitStatus({});
    setError("");
    setPhase("idle");
    if (input.current) input.current.value = "";
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f && (phase === "idle" || phase === "listed" || phase === "planned" || phase === "done" || phase === "stopped")) void open(f);
  };

  const busy = phase === "scanning" || phase === "uploading" || phase === "listing";
  const read = rows.filter((r) => r.status === "listo");
  const byCampaign = CAMPAIGNS.map((c) => ({ c, units: plan.filter((u) => u.campaign === c.code) })).filter((x) => x.units.length);
  const saved = Object.values(unitStatus).filter((s) => s.state === "listo").length;
  const failed = Object.values(unitStatus).filter((s) => s.state === "error").length;

  return (
    <>
      <PageHeader
        title="Carga histórica (ZIP)"
        subtitle="Un ZIP con las tipificaciones de varios meses y campañas: se reconoce cada archivo y cada llamada se guarda en el mes de su fecha."
        actions={
          <Link to="/carga" className="inline-flex items-center gap-2 text-[13px] font-medium text-brand-600 hover:underline">
            <ArrowLeft className="size-4" aria-hidden /> Centro de carga
          </Link>
        }
      />

      {(phase === "idle" || phase === "listing") && (
        <Card className="mb-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => phase === "idle" && input.current?.click()}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-14 text-center transition-colors ${
              dragging ? "border-brand-500 bg-brand-50 dark:bg-brand-500/10" : "border-slate-300 hover:border-brand-500/60 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/40"
            }`}
          >
            {phase === "listing" ? <LoaderCircle className="mb-3 size-10 animate-spin text-brand-500" aria-hidden /> : <FileArchive className="mb-3 size-10 text-brand-500" aria-hidden />}
            <p className="font-medium">{phase === "listing" ? "Abriendo el ZIP…" : "Arrastra aquí el ZIP tal cual, sin descomprimirlo"}</p>
            <p className="mt-1 max-w-lg text-sm text-slate-500">
              Puede traer carpetas por campaña o por mes. La campaña se toma del nombre del archivo o de su carpeta (TDC, Extra, CDC, UPIN, Seguros, DOMI) y el mes, de la fecha de cada
              llamada.
            </p>
            <input
              ref={input}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void open(f);
              }}
            />
          </div>
          {error && (
            <div className="mt-4">
              <ErrorMessage>{error}</ErrorMessage>
            </div>
          )}
        </Card>
      )}

      {zip && phase !== "idle" && phase !== "listing" && (
        <Card className="mb-6 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div className="flex items-center gap-3">
              <FileArchive className="size-5 text-brand-500" aria-hidden />
              <div>
                <p className="font-semibold">{zip.name}</p>
                <p className="text-sm text-slate-500">
                  {(zip.size / 1024 / 1024).toFixed(1)} MB · {sheets.length === 1 ? "1 archivo de Excel" : `${sheets.length} archivos de Excel`}
                  {read.length > 0 && ` · ${fmt.format(read.reduce((s, r) => s + r.rows, 0))} llamadas leídas`}
                </p>
              </div>
            </div>
            {!busy && (
              <Button variant="secondary" onClick={reset}>
                Elegir otro ZIP
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500 uppercase">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-5 py-2.5 font-semibold">Archivo</th>
                  <th className="px-3 py-2.5 font-semibold">Campaña</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Llamadas</th>
                  <th className="px-5 py-2.5 font-semibold">Meses</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r, i) => (
                  <tr key={r.entry.path} className={r.status === "no-excel" ? "text-slate-400" : ""}>
                    <td className="max-w-80 px-5 py-2.5">
                      <p className="truncate font-medium" title={r.entry.path}>
                        {r.entry.name}
                      </p>
                      {r.entry.path !== r.entry.name && <p className="truncate text-xs text-slate-500">{r.entry.path.slice(0, -r.entry.name.length - 1)}</p>}
                    </td>
                    <td className="px-3 py-2.5">
                      {r.status === "no-excel" ? (
                        <span className="text-xs">No es Excel: se ignora</span>
                      ) : (
                        <select
                          aria-label={`Campaña de ${r.entry.name}`}
                          disabled={busy || r.status === "listo"}
                          value={r.campaign ?? ""}
                          onChange={(e) => setCampaign(i, (e.target.value || null) as CampaignCode | null)}
                          className={`rounded-lg border bg-white px-2.5 py-1.5 text-sm dark:bg-slate-900 ${r.campaign ? "border-slate-300 dark:border-slate-700" : "border-amber-400"}`}
                        >
                          <option value="">Elige la campaña…</option>
                          {CAMPAIGNS.map((c) => (
                            <option key={c.code} value={c.code}>
                              {c.shortName}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{r.status === "listo" ? fmt.format(r.rows) : ""}</td>
                    <td className="px-5 py-2.5 text-xs text-slate-600 dark:text-slate-300">
                      {r.status === "leyendo" && (
                        <span className="inline-flex items-center gap-1.5 text-brand-600">
                          <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Leyendo…
                        </span>
                      )}
                      {r.status === "listo" &&
                        Object.entries(r.byMonth)
                          .sort(([a], [b]) => a.localeCompare(b))
                          .map(([m, n]) => `${monthLabel(m).split(" ")[0]} ${m.slice(2, 4)}: ${fmt.format(n)}`)
                          .join(" · ")}
                      {(r.status === "otro-tipo" || r.status === "error") && <span className="text-amber-700 dark:text-amber-300">{r.note}</span>}
                      {r.status === "listo" && r.note && <span className="text-slate-400"> · {r.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(phase === "listed" || phase === "scanning") && (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 px-5 py-4 dark:border-slate-800">
              <Button onClick={scan} disabled={busy || missingCampaign || !sheets.length} loading={phase === "scanning"}>
                Leer y repartir por mes
              </Button>
              {phase === "scanning" && (
                <>
                  <span className="text-xs text-slate-500" aria-live="polite">
                    {step}
                  </span>
                  <Button variant="secondary" onClick={() => (cancelled.current = true)}>
                    Detener
                  </Button>
                </>
              )}
              {missingCampaign && phase === "listed" && <span className="text-xs text-amber-700 dark:text-amber-300">Elige la campaña de los archivos marcados.</span>}
            </div>
          )}
        </Card>
      )}

      {(phase === "planned" || phase === "uploading" || phase === "done" || phase === "stopped") && (
        <Card className="mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Reparto por campaña y mes</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                {toUpload.length === 1 ? "1 mes por guardar" : `${toUpload.length} meses por guardar`} · {fmt.format(totalRows)} llamadas
                {plan.length > toUpload.length && ` · ${plan.length - toUpload.length} ya cargados se saltan`}
              </p>
            </div>
            {plan.some((u) => u.exists) && phase === "planned" && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="accent-brand-500" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                Reemplazar los meses que ya tienen tipificaciones
              </label>
            )}
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
            {byCampaign.map(({ c, units }) => (
              <div key={c.code}>
                <p className="mb-2 text-sm font-semibold">{c.shortName}</p>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {units.map((u) => {
                    const k = unitKey(u.campaign, u.month);
                    const st = unitStatus[k];
                    return (
                      <li key={k} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2 text-sm">
                        <span className="w-32 capitalize">{monthLabel(u.month)}</span>
                        <span className="flex-1 text-right text-slate-600 tabular-nums dark:text-slate-300">{fmt.format(u.rows)}</span>
                        <span className="w-44 text-right text-xs">
                          {st?.state === "listo" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600">
                              <CircleCheck className="size-3.5" aria-hidden /> Guardado
                            </span>
                          ) : st?.state === "guardando" ? (
                            <span className="text-brand-600 tabular-nums">Guardando {u.rows ? Math.round((st.done / u.rows) * 100) : 0}%</span>
                          ) : st?.state === "error" ? (
                            <span className="text-amber-700 dark:text-amber-300" title={st.message}>
                              {st.message ?? "No se guardó"}
                            </span>
                          ) : !u.upload ? (
                            <span className="text-slate-400">Ya cargado: se salta</span>
                          ) : u.exists ? (
                            <span className="text-amber-700 dark:text-amber-300">Reemplaza al cargado</span>
                          ) : (
                            <span className="text-slate-500">{u.files.length > 1 ? `Nuevo · ${u.files.length} archivos` : "Nuevo"}</span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {totalRows > FREE_DAILY_ROWS && phase === "planned" && (
            <p className="mt-5 flex gap-2 rounded-xl bg-blue-50 px-3.5 py-2.5 text-sm text-blue-800 dark:bg-blue-500/10 dark:text-blue-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
              Son {fmt.format(totalRows)} llamadas. Si tu plan de Cloudflare es el gratuito (100 000 filas escritas por día), la carga se detiene sola al llegar al límite: lo guardado no se
              pierde y mañana vuelves a cargar el mismo ZIP; los meses ya guardados se saltan.
            </p>
          )}
          {error && (
            <div className="mt-4">
              <ErrorMessage>{error}</ErrorMessage>
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            {phase === "planned" && (
              <Button onClick={upload} disabled={!toUpload.length}>
                <CloudUpload className="size-4" aria-hidden /> Guardar {toUpload.length === 1 ? "1 mes" : `${toUpload.length} meses`}
              </Button>
            )}
            {phase === "uploading" && (
              <>
                <span className="inline-flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300" aria-live="polite">
                  <LoaderCircle className="size-4 animate-spin text-brand-500" aria-hidden />
                  {step || "Guardando…"} ({saved} de {toUpload.length})
                </span>
                <Button variant="secondary" onClick={() => (cancelled.current = true)}>
                  Detener
                </Button>
                <span className="w-full text-xs text-slate-400">No cierres esta pestaña hasta que termine.</span>
              </>
            )}
            {(phase === "done" || phase === "stopped") && (
              <>
                <p className="text-sm">
                  {phase === "done" ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
                      <CircleCheck className="size-4" aria-hidden /> Listo: {saved === 1 ? "1 mes guardado" : `${saved} meses guardados`}
                      {failed > 0 && `, ${failed} con error`}.
                    </span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300">
                      Se detuvo con {saved === 1 ? "1 mes guardado" : `${saved} meses guardados`}. Vuelve a cargar el mismo ZIP para continuar: los meses ya guardados se saltan.
                    </span>
                  )}
                </p>
                <Button variant="secondary" onClick={reset}>
                  Cargar otro ZIP
                </Button>
              </>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
