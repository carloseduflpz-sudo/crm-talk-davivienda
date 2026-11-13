/* Desglose de una cifra de ventas (evaluadas, aprobadas, rechazadas, pendientes…): cuántas hay en cada etapa y
   estatus, del mes, de la cosecha y en total, con el % que representa cada una. Sin lista de clientes. */
import { getCampaign, type CampaignCode, type SaleClass } from "@crm/core";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Fragment, useEffect, useRef } from "react";
import { consultaAnalisis, type Dias } from "../lib/consultas";
import { monthLabel } from "../lib/xlsx";
import { fmtInt, fmtPct } from "./charts";

export interface DesgloseSpec {
  titulo: string;
  /** Qué clases de venta entran (null = todas). */
  clases: SaleClass[] | null;
  /** Mes del desglose (por defecto, el que se está viendo). */
  mes: string;
}

const COLOR: Record<SaleClass, string> = { aprobado: "var(--st-good)", rechazado: "var(--st-critical)", en_proceso: "var(--st-warning)" };

export function Desglose({
  campaign,
  agent,
  dias,
  spec,
  onClose,
  onClientes,
}: {
  campaign: CampaignCode;
  agent: string | null;
  dias: Dias;
  spec: DesgloseSpec;
  onClose: () => void;
  /** Abre la lista de clientes de lo mismo (solo para el mes que se está viendo). */
  onClientes?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      before?.focus?.();
    };
  }, [onClose]);

  const q = useQuery(consultaAnalisis(campaign, spec.mes, agent, dias));
  const a = q.data?.month === spec.mes ? q.data : undefined;
  const etapas = (a?.ventas?.pcbm?.etapas ?? []).filter((e) => !spec.clases || spec.clases.includes(e.clase));
  const conEtapa = etapas.some((e) => e.etapa !== "(sin etapa)");
  const total = etapas.reduce((t, e) => t + e.ventas, 0);
  const cosecha = etapas.reduce((t, e) => t + e.cosecha, 0);
  const delMes = total - cosecha;
  // Agrupadas por etapa, con su subtotal (como la tabla dinámica).
  const grupos = [...new Set(etapas.map((e) => e.etapa))].map((etapa) => {
    const filas = etapas.filter((e) => e.etapa === etapa).sort((x, y) => y.ventas - x.ventas);
    return { etapa, filas, ventas: filas.reduce((t, e) => t + e.ventas, 0), cosecha: filas.reduce((t, e) => t + e.cosecha, 0) };
  });
  const rango = dias ? (dias.desde === dias.hasta ? `día ${dias.desde}` : `del ${dias.desde} al ${dias.hasta}`) : "mes completo";
  const context = [getCampaign(campaign).shortName, monthLabel(spec.mes), rango, agent].filter(Boolean).join(", ");
  const pct = (n: number) => (total ? fmtPct((n / total) * 100) : "—");
  const num = "px-3 py-2.5 text-right tabular-nums";

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="desglose-titulo">
      <div className="fade-in absolute inset-0 bg-[#0e1b3d]/20 backdrop-blur-[2px] dark:bg-black/50" onClick={onClose} aria-hidden />
      <div className="drawer-in absolute inset-y-0 right-0 flex w-full max-w-[860px] flex-col border-l border-hair bg-white shadow-[-24px_0_48px_rgba(14,27,61,0.10)] dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-hair px-6 pt-6 pb-5">
          <div className="min-w-0">
            <p className="text-[12.5px] text-ink-soft first-letter:uppercase">{context}</p>
            <h2 id="desglose-titulo" className="mt-1 text-[20px] leading-tight font-semibold tracking-[-0.01em] text-ink first-letter:uppercase">
              {spec.titulo}
            </h2>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} className="-mr-2 rounded-full p-2 text-ink-soft transition-colors hover:bg-paper hover:text-ink dark:hover:bg-slate-800" aria-label="Cerrar">
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {q.isPending && <p className="text-sm text-ink-soft">Calculando…</p>}
          {q.isError && <p className="text-sm text-[var(--st-critical)]">{q.error.message}</p>}
          {a && (
            <>
              {/* Del mes, cosecha y total. */}
              <div className="mb-6 grid grid-cols-3 gap-3">
                {[
                  { label: "Vendidas en el mes", n: delMes },
                  { label: "Cosecha (meses anteriores)", n: cosecha },
                  { label: "Total", n: total, fuerte: true },
                ].map((k) => (
                  <div key={k.label} className={`rounded-xl border px-4 py-3 ${k.fuerte ? "border-[var(--viz-1)]/40 bg-[var(--viz-1-wash)]" : "border-hair"}`}>
                    <p className="text-[12px] text-ink-soft">{k.label}</p>
                    <p className="mt-0.5 text-[24px] font-semibold tabular-nums text-ink">{fmtInt.format(k.n)}</p>
                    <p className="text-[12px] text-ink-soft">{k.fuerte ? "100%" : `${pct(k.n)} del total`}</p>
                  </div>
                ))}
              </div>

              {total === 0 ? (
                <p className="text-sm text-ink-soft">No hay ventas en este grupo.</p>
              ) : (
                <table className="w-full text-[13.5px]">
                  <thead>
                    <tr className="border-b border-hair text-left text-[12px] text-ink-soft">
                      {conEtapa && <th className="py-2 pr-3 font-normal">Etapa</th>}
                      <th className="py-2 pr-3 font-normal">{conEtapa ? "Subetapa" : "Estatus"}</th>
                      <th className="px-3 py-2 text-right font-normal">Del mes</th>
                      <th className="px-3 py-2 text-right font-normal">Cosecha</th>
                      <th className="px-3 py-2 text-right font-normal">Total</th>
                      <th className="py-2 pl-3 text-right font-normal">% del total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grupos.map((g) => (
                      <Fragment key={g.etapa}>
                        {g.filas.map((e, i) => (
                          <tr key={`${g.etapa}|${e.estatus}|${e.clase}`} className="border-b border-hair">
                            {conEtapa && <td className="py-2.5 pr-3 align-top text-ink">{i === 0 ? g.etapa : ""}</td>}
                            <td className="py-2.5 pr-3">
                              <span className="inline-flex items-center gap-2 text-ink">
                                <span className="size-2 shrink-0 rounded-full" style={{ background: COLOR[e.clase] }} aria-hidden />
                                {e.estatus}
                              </span>
                            </td>
                            <td className={num}>{fmtInt.format(e.ventas - e.cosecha)}</td>
                            <td className={`${num} text-ink-soft`}>{e.cosecha ? fmtInt.format(e.cosecha) : "—"}</td>
                            <td className={`${num} font-medium text-ink`}>{fmtInt.format(e.ventas)}</td>
                            <td className="py-2.5 pl-3 text-right tabular-nums text-ink-soft">{pct(e.ventas)}</td>
                          </tr>
                        ))}
                        {conEtapa && g.filas.length > 1 && (
                          <tr key={`${g.etapa}|sub`} className="border-b border-hair bg-slate-50/70 dark:bg-slate-800/30">
                            <td className="py-2 pr-3 text-[12.5px] text-ink-soft" colSpan={2}>
                              Subtotal {g.etapa}
                            </td>
                            <td className={`${num} py-2 text-[12.5px]`}>{fmtInt.format(g.ventas - g.cosecha)}</td>
                            <td className={`${num} py-2 text-[12.5px] text-ink-soft`}>{g.cosecha ? fmtInt.format(g.cosecha) : "—"}</td>
                            <td className={`${num} py-2 text-[12.5px] font-medium text-ink`}>{fmtInt.format(g.ventas)}</td>
                            <td className="py-2 pl-3 text-right text-[12.5px] tabular-nums text-ink-soft">{pct(g.ventas)}</td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                    <tr className="font-semibold text-ink">
                      <td className="py-3 pr-3" colSpan={conEtapa ? 2 : 1}>
                        Total
                      </td>
                      <td className={num}>{fmtInt.format(delMes)}</td>
                      <td className={num}>{fmtInt.format(cosecha)}</td>
                      <td className={num}>{fmtInt.format(total)}</td>
                      <td className="py-3 pl-3 text-right tabular-nums">100%</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </>
          )}
        </div>
        {onClientes && total > 0 && (
          <div className="border-t border-hair px-6 py-4">
            <button type="button" onClick={onClientes} className="text-[13px] font-medium text-brand-600 hover:underline">
              Ver la lista de clientes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
