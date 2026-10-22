/* Panel lateral con los clientes detrás de una cifra: se abre al hacer clic en un estatus, un motivo,
   una tipificación, un día o un indicador. Búsqueda por NIU o agente y descarga a Excel. */
import { getCampaign, type CampaignCode } from "@crm/core";
import { useQuery } from "@tanstack/react-query";
import { Download, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { downloadExcel } from "../lib/export";
import { monthLabel } from "../lib/xlsx";
import { dayLabel, fmtInt } from "./charts";

export type DetailSource = "ventas" | "llamadas" | "crm" | "base";

export interface DetailSpec {
  fuente: DetailSource;
  /** Qué se está viendo: "Rechazadas por score bajo". */
  title: string;
  filters?: Record<string, string>;
}

const NOUN: Record<DetailSource, [string, string]> = {
  ventas: ["venta", "ventas"],
  llamadas: ["llamada", "llamadas"],
  crm: ["venta capturada", "ventas capturadas"],
  base: ["cliente", "clientes"],
};
const PAGE = 200;
const MAX_EXPORT = 20_000;

/** Presentación de cada celda: fechas legibles y vacíos discretos. */
function cell(key: string, v: unknown, campaign: CampaignCode): string {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v);
  if (key === "dataset") return getCampaign(campaign).datasets.find((d) => d.id === s)?.label ?? s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dayLabel(s);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return `${dayLabel(s.slice(0, 10))}, ${s.slice(11, 16)}`;
  return s;
}

export function ClientDetail({ campaign, month, agent, spec, onClose }: { campaign: CampaignCode; month: string; agent: string | null; spec: DetailSpec; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // La búsqueda espera a que se deje de escribir.
  useEffect(() => {
    const t = setTimeout(() => setSearch(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Escape cierra; el foco entra al panel y vuelve a donde estaba al cerrar.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>("button, input, [tabindex]:not([tabindex='-1'])");
        const first = f[0],
          last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last?.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first?.focus());
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [onClose]);

  const params = { fuente: spec.fuente, mes: month, agente: spec.fuente === "base" ? null : agent, buscar: search, ...spec.filters };
  const detail = useQuery({ queryKey: ["detalle", campaign, params], queryFn: () => api.detail(campaign, { ...params, limite: PAGE }) });
  const [one, many] = NOUN[spec.fuente];
  const d = detail.data;
  const context = [getCampaign(campaign).shortName, monthLabel(month), spec.fuente !== "base" ? agent : null].filter(Boolean).join(", ");

  const exportAll = async () => {
    setExporting(true);
    setError("");
    try {
      const all = await api.detail(campaign, { ...params, limite: MAX_EXPORT });
      const rows = all.rows.map((r) => Object.fromEntries(all.columns.map((c) => [c.key, c.key === "dataset" ? cell(c.key, r[c.key], campaign) : r[c.key]])));
      await downloadExcel(`${getCampaign(campaign).shortName} ${month} ${spec.title}${agent && spec.fuente !== "base" ? ` ${agent}` : ""}.xlsx`, spec.title, all.columns, rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo descargar.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="detalle-titulo">
      <div className="fade-in absolute inset-0 bg-[#0e1b3d]/20 backdrop-blur-[2px] dark:bg-black/50" onClick={onClose} aria-hidden />
      <div ref={panelRef} className="drawer-in absolute inset-y-0 right-0 flex w-full max-w-[760px] flex-col border-l border-hair bg-white shadow-[-24px_0_48px_rgba(14,27,61,0.10)] dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-hair px-6 pt-6 pb-5">
          <div className="min-w-0">
            <p className="text-[12.5px] text-ink-soft">{context}</p>
            <h2 id="detalle-titulo" className="mt-1 text-[20px] leading-tight font-semibold tracking-[-0.01em] text-ink first-letter:uppercase">
              {spec.title}
            </h2>
            <p className="mt-2 text-[13px] text-ink-soft" aria-live="polite">
              {d ? (
                <>
                  <span className="font-medium text-ink tabular-nums">{fmtInt.format(d.total)}</span> {d.total === 1 ? one : many}
                  {search && ` que coinciden con "${search}"`}
                </>
              ) : (
                " "
              )}
            </p>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="-mr-2 rounded-full p-2 text-ink-soft transition-colors hover:bg-paper hover:text-ink dark:hover:bg-slate-800" aria-label="Cerrar">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 px-6 py-4">
          <label className="relative min-w-56 flex-1">
            <span className="sr-only">Buscar por NIU o agente</span>
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={spec.fuente === "base" ? "Buscar NIU" : "Buscar NIU o agente"}
              className="w-full rounded-full border border-hair bg-paper py-2 pr-4 pl-10 text-[13.5px] text-ink outline-none placeholder:text-ink-faint focus:border-brand-500 focus:bg-white dark:focus:bg-slate-900"
            />
          </label>
          <button
            type="button"
            onClick={exportAll}
            disabled={exporting || !d?.total}
            className="inline-flex items-center gap-2 rounded-full border border-hair px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-ink-faint disabled:opacity-50"
          >
            {exporting ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : <Download className="size-4 text-ink-soft" aria-hidden />}
            Descargar Excel
          </button>
        </div>
        {error && <p className="px-6 pb-3 text-[13px] text-[var(--st-critical)]">{error}</p>}
        {d && d.total > MAX_EXPORT && <p className="px-6 pb-3 text-[12.5px] text-ink-faint">La descarga incluye las primeras {fmtInt.format(MAX_EXPORT)}.</p>}

        <div className="min-h-0 flex-1 overflow-auto border-t border-hair">
          {detail.isError && <p className="p-6 text-sm text-[var(--st-critical)]">{detail.error.message}</p>}
          {!d && !detail.isError && (
            <div className="space-y-3 p-6" aria-label="Cargando">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="h-4 animate-pulse rounded-full bg-paper dark:bg-slate-800" style={{ width: `${90 - (i % 3) * 15}%` }} />
              ))}
            </div>
          )}
          {d && d.rows.length === 0 && <p className="p-6 text-sm text-ink-soft">No hay {many} con este filtro.</p>}
          {d && d.rows.length > 0 && (
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 z-10 bg-white dark:bg-slate-900">
                <tr className="text-[12px] text-ink-faint">
                  {d.columns.map((c) => (
                    <th key={c.key} className="border-b border-hair px-4 py-3 text-left font-normal whitespace-nowrap first:pl-6 last:pr-6">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className={detail.isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}>
                {d.rows.map((r, i) => (
                  <tr key={i} className="border-b border-hair last:border-0 hover:bg-paper/60 dark:hover:bg-slate-800/40">
                    {d.columns.map((c, j) => (
                      <td key={c.key} className={`max-w-64 truncate px-4 py-2.5 whitespace-nowrap first:pl-6 last:pr-6 ${j === 0 ? "font-medium text-ink tabular-nums" : "text-ink/80"}`} title={String(r[c.key] ?? "")}>
                        {cell(c.key, r[c.key], campaign) || <span className="text-ink-faint">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {d && d.total > d.rows.length && (
          <p className="border-t border-hair px-6 py-3 text-[12.5px] text-ink-soft">
            Se muestran {fmtInt.format(d.rows.length)} de {fmtInt.format(d.total)}. Busca un NIU o descarga el Excel para verlos todos.
          </p>
        )}
      </div>
    </div>
  );
}
