/* Carga masiva: un ZIP (o varios archivos sueltos) con tipificaciones, ventas del CRM o sábanas de varios meses
   y campañas. Se reconoce cada archivo y cada campaña × mes queda como una carga normal (con versión y todo lo demás).
   - Tipificaciones y ventas: cada fila va al mes de su fecha.
   - Sábanas: cada archivo es la sábana de un mes y se guarda completa, con su cosecha (ver core/bulk.ts). */
import {
  CAMPAIGNS,
  chunkEnds,
  compareSabanas,
  getCampaign,
  guessCampaign,
  isSheetFile,
  listZip,
  mesDeSabana,
  planBulk,
  planSabanas,
  readZipEntry,
  rowMonth,
  rowsByMonth,
  summarizeSales,
  unitKey,
  type BulkKind,
  type BulkUnit,
  type CampaignCode,
  type NormalizedRow,
  type ZipEntry,
} from "@crm/core";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CircleCheck, CloudUpload, FileArchive, LoaderCircle, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { Button, ErrorMessage } from "../components/form";
import { Card, PageHeader } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { ExcelReader, ReadCancelled } from "../lib/excel";
import { monthFromName, monthLabel } from "../lib/xlsx";

const fmt = new Intl.NumberFormat("es-SV");
/** Más allá de esto conviene avisar por el límite diario del plan gratuito de Cloudflare. */
const FREE_DAILY_ROWS = 100_000;

/** Qué se carga: cada tipo con sus palabras para la pantalla. */
const TIPOS: Record<BulkKind, { label: string; filas: string; detalle: string }> = {
  tipif: { label: "Tipificaciones", filas: "llamadas", detalle: "cada llamada se guarda en el mes de su fecha" },
  ventas: { label: "Ventas del CRM", filas: "ventas", detalle: "cada venta se guarda en el mes de su fecha" },
  sabana: { label: "Sábanas", filas: "ventas", detalle: "cada archivo es la sábana de un mes y se guarda completa, con su cosecha" },
};
/** Los últimos 13 meses (para corregir el mes de una sábana aunque el archivo no traiga ventas de ese mes). */
const ultimosMeses = Array.from({ length: 13 }, (_, i) => {
  const d = new Date();
  d.setDate(15);
  d.setMonth(d.getMonth() - i);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
});
const esTipo = (v: string | null): v is BulkKind => v === "tipif" || v === "ventas" || v === "sabana";

/** De dónde sale cada archivo: de un ZIP o suelto. */
interface Fuente {
  path: string;
  name: string;
  zip?: File;
  entry?: ZipEntry;
  file?: File;
}

type FileStatus = "pendiente" | "leyendo" | "listo" | "otro-tipo" | "error" | "no-excel";
interface Row {
  entry: Fuente;
  campaign: CampaignCode | null;
  /** Sábanas: mes del archivo (del nombre o del mes más reciente de sus ventas). */
  month: string | null;
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

/** Lee un archivo (del ZIP o suelto) con las reglas de esa campaña. */
async function readCalls(row: Row, onStep: (s: string) => void): Promise<{ rows: NormalizedRow[]; sha: string; datasetId: string | null; dropped: number; error: string | null }> {
  const f = row.entry;
  const file = f.file ?? new File([(await readZipEntry(f.zip!, f.entry!)) as BlobPart], f.name);
  const reader = new ExcelReader();
  try {
    const { result, sha } = await reader.open(file, row.campaign!, onStep);
    return { rows: result.rows, sha, datasetId: result.datasetId, dropped: result.dropped, error: result.error };
  } finally {
    reader.close();
  }
}

export function BulkUpload() {
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const kind: BulkKind = esTipo(params.get("tipo")) ? (params.get("tipo") as BulkKind) : "tipif";
  const tipo = TIPOS[kind];
  // Lo que se eligió: un ZIP, varios, o archivos sueltos (para el encabezado).
  const [zip, setZip] = useState<{ name: string; size: number } | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState("");
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  // Campaña × mes que ya tiene una carga vigente de este tipo → su id (para comparar sábanas).
  const [existing, setExisting] = useState<Map<string, string>>(new Map());
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

  const open = async (files: File[]) => {
    setError("");
    if (!files.length) return;
    const raros = files.filter((f) => !/\.zip$/i.test(f.name) && !isSheetFile(f.name));
    if (raros.length === files.length) {
      setError("Elige un ZIP o archivos de Excel (.xlsx, .xlsb, .xls, .csv).");
      return;
    }
    setPhase("listing");
    try {
      const fuentes: Fuente[] = [];
      for (const f of files) {
        if (/\.zip$/i.test(f.name)) {
          for (const entry of await listZip(f)) fuentes.push({ path: files.length > 1 ? `${f.name.replace(/\.zip$/i, "")}/${entry.path}` : entry.path, name: entry.name, zip: f, entry });
        } else {
          fuentes.push({ path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name, name: f.name, file: f });
        }
      }
      setZip({ name: files.length === 1 ? files[0]!.name : `${files.length} archivos`, size: files.reduce((t, f) => t + f.size, 0) });
      setRows(
        fuentes.map((entry) => ({
          entry,
          campaign: guessCampaign(entry.path),
          month: null,
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
  const setCampaign = (i: number, c: CampaignCode | null) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, campaign: c, month: null, status: r.status === "no-excel" ? r.status : "pendiente", byMonth: {}, rows: 0 } : r)));
  const setMonth = (i: number, m: string) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, month: m } : r)));

  /* Paso 1: leer cada archivo y ver de qué meses trae llamadas. */
  const scan = async () => {
    if (!zip) return;
    cancelled.current = false;
    setPhase("scanning");
    setError("");
    // Qué campaña × mes ya tiene una carga vigente de este tipo.
    try {
      const lists = await Promise.all(CAMPAIGNS.map((c) => api.uploads(c.code)));
      setExisting(new Map(lists.flat().filter((u) => u.isCurrent && u.kind === kind).map((u) => [unitKey(u.campaign, u.month), u.id] as const)));
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
        const res = await readCalls(r, (s) => setStep(`${r.entry.name}: ${s}`));
        if (res.datasetId !== `${r.campaign}:${kind}`) {
          const es = res.datasetId ? getCampaign(r.campaign!).datasets.find((d) => d.id === res.datasetId)?.label ?? res.datasetId : null;
          next[i] = { ...r, status: "otro-tipo", note: es ? `Es ${es}: súbelo con ese tipo de carga o en el Centro de carga.` : res.error ?? `No parece de ${tipo.label.toLowerCase()} de ${getCampaign(r.campaign!).shortName}.` };
        } else {
          const by = rowsByMonth(res.rows);
          // Sábana: el mes del nombre del archivo (o su carpeta); si no lo dice, el más reciente de sus ventas.
          const month = kind === "sabana" ? (monthFromName(r.entry.path.replace(/\//g, " ")) ?? mesDeSabana(by.byMonth)) : null;
          next[i] = { ...r, status: "listo", month, byMonth: by.byMonth, rows: res.rows.length, dropped: res.dropped, sha: res.sha, note: by.sinFecha ? `${fmt.format(by.sinFecha)} sin fecha` : "" };
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

  const existe = useMemo(() => new Set(existing.keys()), [existing]);
  const plan = useMemo(
    () =>
      kind === "sabana"
        ? planSabanas(
            rows.flatMap((r, index) => (r.status === "listo" && r.campaign && r.month ? [{ index, campaign: r.campaign, month: r.month, rows: r.rows }] : [])),
            existe,
            replace,
          )
        : planBulk(
            rows.flatMap((r, index) => (r.status === "listo" && r.campaign ? [{ index, campaign: r.campaign, byMonth: r.byMonth }] : [])),
            existe,
            replace,
          ),
    [rows, existe, replace, kind],
  );
  const sinMes = kind === "sabana" && rows.some((r) => r.status === "listo" && !r.month);
  const conflictos = plan.filter((u) => u.conflicto).length;
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
            dataset: `${u.campaign}:${kind}`,
            month: u.month,
            fileName: `${zip.name.endsWith("archivos") ? "" : `${zip.name} › `}${names[0]}${names.length > 1 ? ` y ${names.length - 1} más` : ""}`.slice(0, 290),
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

    // Sábanas: cada archivo completo es la carga de su mes. Si reemplaza a una vigente, antes se comparan:
    // si la nueva trae menos (menos ventas, llega a un día anterior, le falta cosecha), no se reemplaza.
    if (kind === "sabana") {
      for (const u of toUpload) {
        if (stopped || cancelled.current) break;
        const k = unitKey(u.campaign, u.month);
        const r = rows[u.files[0]!]!;
        setStep(`Leyendo ${r.entry.name}…`);
        try {
          const data = (await readCalls(r, (s) => setStep(`${r.entry.name}: ${s}`))).rows;
          const vigente = existing.get(k);
          if (vigente) {
            const diff = compareSabanas(await api.sabanaSummary(vigente), summarizeSales(data, u.month), u.month);
            if (diff.menos) {
              const que = diff.puntos.filter((p) => p.menos).map((p) => `${p.que}: ${p.antes} → ${p.ahora}`).join(" · ");
              set(k, { state: "error", done: 0, message: `Trae menos que la cargada (${que}). No se reemplazó; si es correcta, súbela en el Centro de carga.` });
              continue;
            }
          }
          setStep(`Guardando ${getCampaign(u.campaign).shortName} de ${monthLabel(u.month)}…`);
          await save(u, data);
        } catch (e) {
          set(k, { state: "error", done: 0, message: e instanceof Error ? e.message : "No se pudo leer." });
        }
      }
    }

    for (const fi of kind === "sabana" ? [] : fileOrder) {
      if (stopped || cancelled.current) break;
      const r = rows[fi]!;
      setStep(`Leyendo ${r.entry.name}…`);
      let data: NormalizedRow[];
      try {
        data = (await readCalls(r, (s) => setStep(`${r.entry.name}: ${s}`))).rows;
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
    const fs = [...e.dataTransfer.files];
    if (fs.length && (phase === "idle" || phase === "listed" || phase === "planned" || phase === "done" || phase === "stopped")) void open(fs);
  };

  const busy = phase === "scanning" || phase === "uploading" || phase === "listing";
  const read = rows.filter((r) => r.status === "listo");
  const byCampaign = CAMPAIGNS.map((c) => ({ c, units: plan.filter((u) => u.campaign === c.code) })).filter((x) => x.units.length);
  const saved = Object.values(unitStatus).filter((s) => s.state === "listo").length;
  const failed = Object.values(unitStatus).filter((s) => s.state === "error").length;

  return (
    <>
      <PageHeader
        title="Carga masiva"
        subtitle={`Un ZIP o varios archivos de ${tipo.label.toLowerCase()} de varios meses y campañas a la vez: se reconoce cada archivo y ${tipo.detalle}.`}
        actions={
          <Link to="/carga" className="inline-flex items-center gap-2 text-[13px] font-medium text-brand-600 hover:underline">
            <ArrowLeft className="size-4" aria-hidden /> Centro de carga
          </Link>
        }
      />

      <div role="tablist" aria-label="Qué vas a cargar" className="mb-5 flex flex-wrap gap-2">
        {(Object.keys(TIPOS) as BulkKind[]).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={k === kind}
            disabled={busy}
            onClick={() => {
              if (k === kind) return;
              reset();
              setParams({ tipo: k });
            }}
            className={`rounded-full border px-4 py-1.5 text-[13px] transition-colors disabled:opacity-50 ${
              k === kind ? "border-brand-500 bg-brand-50 font-medium text-brand-600 dark:bg-brand-500/15 dark:text-white" : "border-hair text-ink-soft hover:border-brand-500/50"
            }`}
          >
            {TIPOS[k].label}
          </button>
        ))}
      </div>

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
            <p className="font-medium">{phase === "listing" ? "Abriendo los archivos…" : `Arrastra aquí tus ${tipo.label.toLowerCase()}: un ZIP tal cual o varios archivos de Excel a la vez`}</p>
            <p className="mt-1 max-w-lg text-sm text-slate-500">
              La campaña se toma del nombre del archivo o de su carpeta (TDC, Extra, CDC, UPIN, Seguros, DOMI).{" "}
              {kind === "sabana"
                ? "El mes, del nombre del archivo; si no lo dice, del mes más reciente de sus ventas. Lo puedes corregir antes de guardar."
                : `El mes, de la fecha de cada ${kind === "tipif" ? "llamada" : "venta"}.`}
            </p>
            <input
              ref={input}
              type="file"
              multiple
              accept=".zip,.xlsx,.xlsb,.xls,.xlsm,.csv"
              className="hidden"
              onChange={(e) => {
                const fs = [...(e.target.files ?? [])];
                if (fs.length) void open(fs);
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
                  {read.length > 0 && ` · ${fmt.format(read.reduce((s, r) => s + r.rows, 0))} ${tipo.filas} leídas`}
                </p>
              </div>
            </div>
            {!busy && (
              <Button variant="secondary" onClick={reset}>
                Elegir otros archivos
              </Button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-slate-500 uppercase">
                <tr className="border-b border-slate-200 dark:border-slate-800">
                  <th className="px-5 py-2.5 font-semibold">Archivo</th>
                  <th className="px-3 py-2.5 font-semibold">Campaña</th>
                  <th className="px-3 py-2.5 text-right font-semibold">{tipo.filas.charAt(0).toUpperCase() + tipo.filas.slice(1)}</th>
                  <th className="px-5 py-2.5 font-semibold">{kind === "sabana" ? "Mes de la sábana" : "Meses"}</th>
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
                      {r.status === "listo" && kind === "sabana" && (
                        <span className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label={`Mes de ${r.entry.name}`}
                            disabled={busy}
                            value={r.month ?? ""}
                            onChange={(e) => setMonth(i, e.target.value)}
                            className={`rounded-lg border bg-white px-2.5 py-1.5 text-sm capitalize dark:bg-slate-900 ${r.month ? "border-slate-300 dark:border-slate-700" : "border-amber-400"}`}
                          >
                            <option value="">Elige el mes…</option>
                            {[...new Set([...(r.month ? [r.month] : []), ...Object.keys(r.byMonth), ...ultimosMeses])]
                              .sort()
                              .reverse()
                              .map((m) => (
                                <option key={m} value={m}>
                                  {monthLabel(m)}
                                </option>
                              ))}
                          </select>
                          {(() => {
                            const cosecha = Object.keys(r.byMonth).filter((m) => r.month && m < r.month).length;
                            return cosecha > 0 ? <span className="text-slate-500">con cosecha de {cosecha === 1 ? "1 mes anterior" : `${cosecha} meses anteriores`}</span> : null;
                          })()}
                        </span>
                      )}
                      {r.status === "listo" &&
                        kind !== "sabana" &&
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
                {kind === "sabana" ? "Leer y reconocer el mes" : "Leer y repartir por mes"}
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
                {toUpload.length === 1 ? "1 mes por guardar" : `${toUpload.length} meses por guardar`} · {fmt.format(totalRows)} {tipo.filas}
                {plan.length - toUpload.length - conflictos > 0 && ` · ${plan.length - toUpload.length - conflictos} ya cargados se saltan`}
              </p>
              {(conflictos > 0 || sinMes) && (
                <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
                  {conflictos > 0 && "Hay meses con dos sábanas: corrige arriba el mes de una de ellas (mientras tanto ese mes no se guarda). "}
                  {sinMes && "Hay sábanas sin mes: elígelo arriba."}
                </p>
              )}
            </div>
            {plan.some((u) => u.exists) && phase === "planned" && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input type="checkbox" className="accent-brand-500" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
                Reemplazar los meses que ya tienen {tipo.label.toLowerCase()}
                {kind === "sabana" && " (si la nueva trae menos que la cargada, no se reemplaza)"}
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
                          ) : u.conflicto ? (
                            <span className="text-amber-700 dark:text-amber-300">{u.files.length} sábanas de este mes</span>
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
              Son {fmt.format(totalRows)} {tipo.filas}. Si tu plan de Cloudflare es el gratuito (100 000 filas escritas por día), la carga se detiene sola al llegar al límite: lo guardado no se
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
                  {phase === "done" && saved === 0 && failed > 0 ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-amber-700 dark:text-amber-300">
                      <TriangleAlert className="size-4" aria-hidden /> No se guardó ningún mes: revisa el aviso de cada uno.
                    </span>
                  ) : phase === "done" ? (
                    <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-300">
                      <CircleCheck className="size-4" aria-hidden /> Listo: {saved === 1 ? "1 mes guardado" : `${saved} meses guardados`}
                      {failed > 0 && `, ${failed} con error`}.
                    </span>
                  ) : (
                    <span className="text-amber-700 dark:text-amber-300">
                      Se detuvo con {saved === 1 ? "1 mes guardado" : `${saved} meses guardados`}. Vuelve a cargar los mismos archivos para continuar: los meses ya guardados se saltan.
                    </span>
                  )}
                </p>
                <Button variant="secondary" onClick={reset}>
                  Cargar otros archivos
                </Button>
              </>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
