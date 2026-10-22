/* Meta del mes con su configuración:
   - cuántas ventas y cuántos agentes,
   - qué estatus de la sábana cuentan (por defecto: entregado, desembolsado, aplicado o activo),
   - qué días se trabajan y qué días del mes son feriado (el ritmo se mide en días hábiles). */
import { GOAL_STATUS_PREFIXES, businessDays, daysInMonth, type CampaignAnalysis, type CampaignCode } from "@crm/core";
import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import { api } from "../lib/api";
import { monthLabel } from "../lib/xlsx";
import { fmtInt, fmtNum } from "./charts";
import { Button, ErrorMessage } from "./form";

const WEEK = [
  { d: 1, short: "L", name: "lunes" },
  { d: 2, short: "M", name: "martes" },
  { d: 3, short: "M", name: "miércoles" },
  { d: 4, short: "J", name: "jueves" },
  { d: 5, short: "V", name: "viernes" },
  { d: 6, short: "S", name: "sábado" },
  { d: 0, short: "D", name: "domingo" },
];

/** "a, b y c". */
export const joinY = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);

/** "lunes a viernes", "lunes a sábado", "lunes, miércoles y viernes". */
export function workDaysText(days: number[]): string {
  const order = WEEK.filter((w) => days.includes(w.d));
  if (!order.length) return "ningún día";
  const idx = order.map((w) => WEEK.indexOf(w));
  const consecutive = idx.every((v, i) => i === 0 || v === idx[i - 1]! + 1);
  if (order.length > 2 && consecutive) return `${order[0]!.name} a ${order.at(-1)!.name}`;
  return joinY(order.map((w) => w.name));
}

const Section = ({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }) => (
  <section className="border-t border-hair pt-6">
    <h4 className="text-[14px] font-semibold text-ink">{title}</h4>
    {hint && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-soft">{hint}</p>}
    <div className="mt-4">{children}</div>
  </section>
);

const prefixesText = (campaign: CampaignCode) =>
  GOAL_STATUS_PREFIXES[campaign].map((p) => p.charAt(0) + p.slice(1).toLowerCase() + "…").join(", ");

export function GoalForm({ a, onDone, onCancel }: { a: CampaignAnalysis; onDone: () => void; onCancel?: () => void }) {
  const c = a.cumplimiento;
  const month = a.month!;
  const campaign = a.campaign as CampaignCode;
  const [meta, setMeta] = useState(c.meta !== null && !a.agente ? String(c.meta) : "");
  const [agentes, setAgentes] = useState(c.agentes?.toString() ?? "");
  const [statuses, setStatuses] = useState<string[]>(c.config.estatus);
  const [statusesTouched, setStatusesTouched] = useState(!c.config.estatusPorDefecto);
  const [workDays, setWorkDays] = useState<number[]>(c.config.diasSemana);
  const [holidays, setHolidays] = useState<string[]>(c.config.feriados);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const habiles = useMemo(() => businessDays(month, workDays, holidays), [month, workDays, holidays]);
  const counted = c.estatusDisponibles.filter((e) => statuses.includes(e.label)).reduce((s, e) => s + e.value, 0);
  const pendingSuggested = c.feriadosSugeridos.filter((h) => !holidays.includes(h.date));

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!workDays.length) return setError("Elige al menos un día de la semana que se trabaje.");
    if (c.estatusDisponibles.length && !statuses.length) return setError("Elige al menos un estatus que cuente para la meta.");
    setSaving(true);
    try {
      await api.setGoal({
        campaign,
        month,
        salesGoal: Number(meta),
        agents: agentes ? Number(agentes) : null,
        countedStatuses: statusesTouched ? statuses : null,
        workDays,
        holidays: holidays.filter((d) => d.startsWith(month)),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la meta.");
    } finally {
      setSaving(false);
    }
  };

  // Calendario del mes, semana de lunes a domingo.
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const firstWd = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const lead = (firstWd + 6) % 7;
  const cells: (string | null)[] = [...Array.from({ length: lead }, () => null), ...Array.from({ length: daysInMonth(month) }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  const holidayName = (d: string) => c.feriadosSugeridos.find((h) => h.date === d)?.name;

  const input = "w-full rounded-xl border border-hair bg-paper px-3.5 py-2.5 text-[14px] text-ink tabular-nums outline-none focus:border-brand-500 focus:bg-white dark:focus:bg-slate-900";
  return (
    <form onSubmit={submit} className="space-y-8">
      <div className="flex flex-wrap items-end gap-4">
        <label className="block w-44 text-[13px]">
          <span className="mb-1.5 block text-ink-soft">Meta de ventas</span>
          <input className={input} type="number" min={0} step={1} required value={meta} onChange={(e) => setMeta(e.target.value)} />
        </label>
        <label className="block w-44 text-[13px]">
          <span className="mb-1.5 block text-ink-soft">Agentes</span>
          <input className={input} type="number" min={1} step={1} value={agentes} onChange={(e) => setAgentes(e.target.value)} placeholder="Opcional" />
        </label>
        {meta && agentes && Number(agentes) > 0 && (
          <p className="pb-3 text-[13px] text-ink-soft">
            {fmtNum(Number(meta) / Number(agentes))} ventas por agente
          </p>
        )}
      </div>

      <Section
        title="Qué cuenta para la meta"
        hint={
          c.estatusDisponibles.length
            ? "Solo las ventas con estos estatus del banco suman al avance. Por defecto: lo entregado, desembolsado, aplicado o activo."
            : `Cuando cargues la sábana de ${monthLabel(month)} podrás elegir los estatus. Mientras tanto cuentan los que empiezan con: ${prefixesText(campaign)}`
        }
      >
        {c.estatusDisponibles.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2">
              {c.estatusDisponibles.map((e) => {
                const on = statuses.includes(e.label);
                return (
                  <button
                    key={e.label}
                    type="button"
                    aria-pressed={on}
                    onClick={() => {
                      setStatuses((s) => toggle(s, e.label));
                      setStatusesTouched(true);
                    }}
                    className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
                      on ? "border-[var(--st-good)] bg-[var(--st-good)]/10 text-ink" : "border-hair text-ink-soft hover:border-ink-faint hover:text-ink"
                    }`}
                  >
                    <span className={`size-2 rounded-full ${on ? "bg-[var(--st-good)]" : "bg-hair"}`} aria-hidden />
                    <span className="first-letter:uppercase">{e.label.toLowerCase()}</span>
                    <span className="text-ink-faint tabular-nums">{fmtInt.format(e.value)}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-[13px] text-ink-soft">
              Con esta selección cuentan <span className="font-medium text-ink tabular-nums">{fmtInt.format(counted)}</span> de {fmtInt.format(c.ventasTotales)} ventas de la sábana.
              {statusesTouched && (
                <>
                  {" "}
                  <button
                    type="button"
                    className="font-medium text-brand-600 hover:underline"
                    onClick={() => {
                      setStatuses(c.estatusDisponibles.filter((e) => GOAL_STATUS_PREFIXES[campaign].some((p) => e.label.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").startsWith(p))).map((e) => e.label));
                      setStatusesTouched(false);
                    }}
                  >
                    Volver a la regla por defecto
                  </button>
                </>
              )}
            </p>
          </>
        )}
      </Section>

      <Section title="Días hábiles" hint="El ritmo diario, la proyección y lo esperado a la fecha se calculan solo con los días que se trabajan.">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Días de la semana que se trabajan">
          {WEEK.map((w) => {
            const on = workDays.includes(w.d);
            return (
              <button
                key={w.d}
                type="button"
                aria-pressed={on}
                title={w.name}
                onClick={() => setWorkDays((d) => toggle(d, w.d).sort())}
                className={`size-10 rounded-full border text-[13px] font-medium transition-colors ${on ? "border-brand-500 bg-brand-500 text-white" : "border-hair text-ink-soft hover:border-ink-faint hover:text-ink"}`}
              >
                {w.short}
                <span className="sr-only"> ({w.name})</span>
              </button>
            );
          })}
          <span className="ml-2 text-[13px] text-ink-soft">Se trabaja de {workDaysText(workDays)}.</span>
        </div>

        <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,320px)_1fr]">
          <div>
            <p className="mb-3 text-[13px] text-ink-soft">Toca un día para marcarlo como feriado o día no laborable.</p>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-ink-faint">
              {WEEK.map((w) => (
                <span key={w.d} className="pb-1">
                  {w.short}
                </span>
              ))}
              {cells.map((d, i) => {
                if (!d) return <span key={`v${i}`} />;
                const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
                const working = workDays.includes(wd);
                const off = holidays.includes(d);
                const suggested = holidayName(d);
                return (
                  <button
                    key={d}
                    type="button"
                    disabled={!working}
                    aria-pressed={off}
                    title={off ? `Feriado${suggested ? `: ${suggested}` : ""}` : working ? `Día hábil${suggested ? `. Sugerido como feriado: ${suggested}` : ""}` : "No se trabaja"}
                    onClick={() => setHolidays((h) => toggle(h, d))}
                    className={`relative aspect-square rounded-lg text-[13px] tabular-nums transition-colors ${
                      !working ? "text-ink-faint/60" : off ? "bg-[var(--st-critical)]/12 text-[var(--st-critical)] line-through" : "text-ink hover:bg-paper dark:hover:bg-slate-800"
                    }`}
                  >
                    {Number(d.slice(8))}
                    {suggested && !off && working && <span className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-[var(--st-critical)]" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-4 text-[13px] text-ink-soft">
            <p>
              <span className="text-[32px] leading-none font-light tracking-[-0.02em] text-ink tabular-nums">{habiles.length}</span>
              <span className="ml-2">días hábiles en {monthLabel(month)}</span>
            </p>
            {holidays.length > 0 && (
              <p>
                Feriados: {holidays
                  .slice()
                  .sort()
                  .map((d) => `${Number(d.slice(8))}${holidayName(d) ? ` (${holidayName(d)})` : ""}`)
                  .join(", ")}
                .
              </p>
            )}
            {pendingSuggested.length > 0 && (
              <div className="rounded-xl bg-paper px-4 py-3 dark:bg-slate-800/60">
                <p>Feriados nacionales de este mes:</p>
                <ul className="mt-2 space-y-1">
                  {pendingSuggested.map((h) => (
                    <li key={h.date} className="flex items-center justify-between gap-3">
                      <span className="text-ink">
                        {Number(h.date.slice(8))}, {h.name}
                      </span>
                      <button type="button" onClick={() => setHolidays((x) => [...x, h.date])} className="font-medium text-brand-600 hover:underline">
                        Marcar
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3 border-t border-hair pt-6">
        <Button type="submit" loading={saving}>
          Guardar meta de {monthLabel(month)}
        </Button>
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </form>
  );
}
