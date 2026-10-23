/* Ficha del cliente para darle seguimiento: contacto, ventas con todo lo que trae la sábana,
   bases en las que viene, llamadas y capturas del CRM. Se usa en el panel de detalle y en "Cliente (NIU)". */
import { getCampaign, isCampaignCode, type CampaignCode } from "@crm/core";
import { useQuery } from "@tanstack/react-query";
import { Mail, Phone } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api, type ClientFile } from "../lib/api";
import { monthLabel } from "../lib/xlsx";
import { dayLabel, fmtInt, fmtMoney } from "./charts";

const CLASS_TONE: Record<string, { label: string; color: string }> = {
  aprobado: { label: "Aprobada", color: "var(--st-good)" },
  rechazado: { label: "Rechazada", color: "var(--st-critical)" },
  en_proceso: { label: "En proceso", color: "var(--st-warning)" },
};
const CALL_LABEL: Record<string, string> = {
  venta: "Venta",
  negativo: "Contacto negativo",
  no_efectivo: "Contacto no efectivo",
  no_contacto: "No contacto",
  sin_tipificar: "Sin tipificar",
};

/** Fechas legibles; lo demás tal cual. */
function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return dayLabel(s);
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(s)) return `${dayLabel(s.slice(0, 10))}, ${s.slice(11, 16)}`;
  return s;
}

const campaignName = (code: string) => (isCampaignCode(code) ? getCampaign(code as CampaignCode).shortName : code);
const datasetName = (code: string, id: string) => (isCampaignCode(code) ? (getCampaign(code as CampaignCode).datasets.find((d) => d.id === id)?.label ?? id) : id);

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h3 className="mb-3 flex items-baseline gap-2 text-[14px] font-semibold text-ink">
        {title}
        {count !== undefined && <span className="text-[12.5px] font-normal text-ink-faint tabular-nums">{fmtInt.format(count)}</span>}
      </h3>
      {children}
    </section>
  );
}

/** Todos los datos que trae el archivo para esta fila, como lista de "campo: valor". */
function Fields({ data, skip = [] }: { data: Record<string, unknown>; skip?: string[] }) {
  const entries = Object.entries(data).filter(([k, v]) => !skip.includes(k) && show(v) !== "");
  if (!entries.length) return <p className="text-[12.5px] text-ink-faint">El archivo no trae más datos.</p>;
  return (
    <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
      {entries.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-[11.5px] text-ink-faint">{k}</dt>
          <dd className="text-[13px] break-words text-ink">{show(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

const fmtLoaded = (ms: number) => new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));

type Sale = ClientFile["campanas"][number]["ventas"][number];
/** La misma venta aparece en la sábana de varios meses (cosecha): se muestra una vez, con su estatus más reciente y cómo cambió. */
function groupSales(ventas: Sale[]): { last: Sale; history: Sale[] }[] {
  const groups = new Map<string, Sale[]>();
  for (const v of ventas) {
    const k = `${v.fecha ?? ""}|${v.proceso ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  return [...groups.values()].map((g) => {
    const byMonth = [...g].sort((a, b) => a.month.localeCompare(b.month));
    return { last: byMonth[byMonth.length - 1]!, history: byMonth };
  });
}

function Campaign({ c, multi }: { c: ClientFile["campanas"][number]; multi: boolean }) {
  const [allCalls, setAllCalls] = useState(false);
  const calls = allCalls ? c.llamadas : c.llamadas.slice(0, 8);
  const sales = groupSales(c.ventas);
  return (
    <div className={multi ? "mt-8 border-t border-hair pt-6" : "mt-6"}>
      {multi && <h2 className="text-[16px] font-semibold text-ink">{campaignName(c.campaign)}</h2>}
      <p className="mt-1 text-[12.5px] text-ink-faint">
        {c.sabana ? (
          <>
            Al día con la sábana de {monthLabel(c.sabana.month)} (cargada el {fmtLoaded(c.sabana.cargada)})
          </>
        ) : (
          "Esta campaña todavía no tiene sábana cargada."
        )}
      </p>

      {sales.length > 0 && (
        <Section title="Ventas en la sábana" count={sales.length}>
          <div className="space-y-3">
            {sales.map(({ last: v, history }, i) => {
              const tone = CLASS_TONE[v.clase] ?? CLASS_TONE.en_proceso!;
              return (
                <details key={i} open={i === 0} className="group rounded-2xl border border-hair bg-white p-4 dark:bg-slate-900">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex items-center gap-1.5 text-[13.5px] font-medium text-ink">
                      <span className="size-2 rounded-full" style={{ background: tone.color }} aria-hidden />
                      {v.estatus || tone.label}
                    </span>
                    <span className="text-[12.5px] text-ink-soft">
                      {v.fecha ? `Vendida el ${dayLabel(v.fecha)}` : "Sin fecha de venta"} · {v.agente}
                      {v.proceso ? ` · ${v.proceso}` : ""}
                      {v.monto ? ` · ${fmtMoney(v.monto)}` : ""}
                    </span>
                    <span className="ml-auto text-[12px] text-ink-faint first-letter:uppercase">Sábana de {monthLabel(v.month)}</span>
                  </summary>
                  {history.length > 1 && (
                    <ol className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-soft" aria-label="Cómo cambió el estatus en cada sábana">
                      {history.map((h, j) => (
                        <li key={j} className="flex items-center gap-2">
                          {j > 0 && <span aria-hidden>→</span>}
                          <span>
                            <span className="inline-block first-letter:uppercase">{monthLabel(h.month).split(" ")[0]}</span>: <span className={j === history.length - 1 ? "font-medium text-ink" : ""}>{h.estatus || "sin estatus"}</span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                  {v.motivo && <p className="mt-3 text-[13px] text-[var(--st-critical)]">Motivo: {v.motivo}</p>}
                  {v.dias !== null && <p className="mt-1 text-[12.5px] text-ink-soft">{fmtInt.format(v.dias)} días en proceso</p>}
                  <div className="mt-4 border-t border-hair pt-4">
                    <Fields data={v.extra} />
                  </div>
                </details>
              );
            })}
          </div>
        </Section>
      )}

      {c.bases.length > 0 && (
        <Section title="En la base" count={c.bases.length}>
          <div className="space-y-3">
            {c.bases.map((b, i) => (
              <details key={i} className="rounded-2xl border border-hair bg-white p-4 dark:bg-slate-900">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 [&::-webkit-details-marker]:hidden">
                  <span className="text-[13.5px] font-medium text-ink">{b.adicional ? b.nombreBase || "Base adicional" : datasetName(c.campaign, b.dataset)}</span>
                  <span className="text-[12.5px] text-ink-soft">
                    {[b.perfil && `Perfil ${b.perfil}`, b.oferta && `Oferta ${b.oferta}`].filter(Boolean).join(" · ") || "Sin perfil ni oferta"}
                  </span>
                  <span className="ml-auto text-[12px] text-ink-faint first-letter:uppercase">{monthLabel(b.month)}</span>
                </summary>
                <div className="mt-4 border-t border-hair pt-4">
                  <Fields data={b.extra} />
                </div>
              </details>
            ))}
          </div>
        </Section>
      )}

      {c.llamadas.length > 0 && (
        <Section title="Llamadas" count={c.llamadas.length}>
          <ul className="divide-y divide-hair rounded-2xl border border-hair bg-white dark:bg-slate-900">
            {calls.map((l, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-[13px]">
                <span className="w-36 shrink-0 text-ink-soft tabular-nums">{show(l.fecha) || "Sin fecha"}</span>
                <span className="min-w-0 flex-1 text-ink">
                  {l.tipologia || CALL_LABEL[l.clase] || l.clase}
                  <span className="ml-2 text-[12px] text-ink-faint">{CALL_LABEL[l.clase] ?? l.categoria}</span>
                </span>
                <span className="text-[12.5px] text-ink-soft">{l.agente}</span>
              </li>
            ))}
          </ul>
          {c.llamadas.length > calls.length && (
            <button type="button" onClick={() => setAllCalls(true)} className="mt-2 text-[13px] font-medium text-brand-600 hover:underline">
              Ver las {fmtInt.format(c.llamadas.length)} llamadas
            </button>
          )}
        </Section>
      )}

      {c.crm.length > 0 && (
        <Section title="Capturado en el CRM" count={c.crm.length}>
          <div className="space-y-3">
            {c.crm.map((v, i) => (
              <details key={i} className="rounded-2xl border border-hair bg-white p-4 dark:bg-slate-900">
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 [&::-webkit-details-marker]:hidden">
                  <span className="text-[13.5px] font-medium text-ink">{v.producto || "Venta capturada"}</span>
                  <span className="text-[12.5px] text-ink-soft">
                    {show(v.fecha)} · {v.agente}
                  </span>
                </summary>
                <div className="mt-4 border-t border-hair pt-4">
                  <Fields data={v.extra} />
                </div>
              </details>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/** Ficha completa de un NIU. Con `campaign` solo esa campaña; sin ella, todas. */
export function ClientCard({ niu, campaign }: { niu: string; campaign?: string | null }) {
  const q = useQuery({ queryKey: ["cliente", niu, campaign ?? null], queryFn: () => api.client(niu, campaign) });
  if (q.isPending)
    return (
      <div className="space-y-3" aria-label="Cargando">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-4 animate-pulse rounded-full bg-paper dark:bg-slate-800" style={{ width: `${85 - (i % 3) * 18}%` }} />
        ))}
      </div>
    );
  if (q.isError) return <p className="text-sm text-[var(--st-critical)]">{q.error.message}</p>;
  const f = q.data;
  const k = f.contacto;
  const lugar = [k.municipio, k.departamento].filter(Boolean).join(", ");
  return (
    <div>
      <div>
        <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.01em] text-ink">{k.nombre ?? "Cliente sin nombre en los archivos"}</h2>
        <p className="mt-1.5 text-[13px] text-ink-soft">
          NIU <span className="text-ink tabular-nums">{f.niu}</span>
          {k.dui && (
            <>
              {" "}
              · DUI <span className="text-ink tabular-nums">{k.dui}</span>
            </>
          )}
          {lugar && <> · {lugar}</>}
        </p>
        {(k.telefonos.length > 0 || k.correo) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {k.telefonos.map((t) => (
              <a
                key={t}
                href={`tel:${t.replace(/[^\d+]/g, "")}`}
                className="inline-flex items-center gap-2 rounded-full border border-hair bg-white px-3.5 py-1.5 text-[13px] text-ink transition-colors hover:border-brand-500 dark:bg-slate-900"
              >
                <Phone className="size-3.5 text-ink-soft" aria-hidden /> <span className="tabular-nums">{t}</span>
              </a>
            ))}
            {k.correo && (
              <a
                href={`mailto:${k.correo}`}
                className="inline-flex items-center gap-2 rounded-full border border-hair bg-white px-3.5 py-1.5 text-[13px] text-ink transition-colors hover:border-brand-500 dark:bg-slate-900"
              >
                <Mail className="size-3.5 text-ink-soft" aria-hidden /> {k.correo}
              </a>
            )}
          </div>
        )}
        {!k.telefonos.length && !k.correo && <p className="mt-3 text-[12.5px] text-ink-faint">Los archivos cargados no traen teléfono ni correo de este cliente.</p>}
      </div>

      {f.campanas.length === 0 ? (
        <p className="mt-8 text-sm text-ink-soft">No aparece en ningún archivo vigente{campaign ? ` de ${campaignName(campaign)}` : ""}.</p>
      ) : (
        f.campanas.map((c) => <Campaign key={c.campaign} c={c} multi={f.campanas.length > 1 || !campaign} />)
      )}
    </div>
  );
}
