/* Vista de una campaña: selector de mes + 5 pestañas, todas con los archivos VIGENTES del mes. */
import { getCampaign, isCampaignCode, type CampaignAnalysis, type CampaignCode } from "@crm/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Database, PhoneCall, Target, TrendingUp, Upload, type LucideIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, Navigate, useParams, useSearchParams } from "react-router";
import { AreaChart, BarList, ChartCard, Columns, DataTable, FigureStrip, Meter, PctCell, ShareBar, dayLabel, fmtInt, fmtNum, fmtPct, monthShort } from "../components/charts";
import { Button, ErrorMessage } from "../components/form";
import { EmptyState, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { monthLabel } from "../lib/xlsx";

export const CAMPAIGN_TABS = [
  { slug: "ventas", label: "Ventas", icon: TrendingUp, needs: "sabana", about: "Estatus del banco, rechazo por motivo, ejecutivos y comparativo mensual." },
  { slug: "base", label: "Base", icon: Database, needs: "base", about: "Clientes de la base, perfiles y penetración contra la sábana." },
  { slug: "efectividad", label: "Efectividad", icon: BarChart3, needs: "tipif", about: "Contactabilidad, registros y penetración, general y por agente." },
  { slug: "llamadas", label: "Llamadas", icon: PhoneCall, needs: "tipif", about: "Tipificaciones, intentos por cliente y ventas capturadas en el CRM." },
  { slug: "cumplimiento", label: "Cumplimiento", icon: Target, needs: "sabana", about: "Meta, avance, ritmo, proyección y gap por agente." },
] as const;

const SALE_COLORS = { aprobado: "var(--st-good)", en_proceso: "var(--st-warning)", rechazado: "var(--st-critical)" } as Record<string, string>;
const SALE_LABEL = { aprobado: "Aprobadas", en_proceso: "En proceso", rechazado: "Rechazadas" } as Record<string, string>;
const CALL_ORDER = ["venta", "negativo", "no_efectivo", "no_contacto", "sin_tipificar"] as const;
const CALL_COLORS: Record<string, string> = {
  venta: "var(--viz-1)",
  negativo: "var(--viz-2)",
  no_efectivo: "var(--viz-3)",
  no_contacto: "var(--viz-4)",
  sin_tipificar: "var(--viz-5)",
};
const CALL_LABEL: Record<string, string> = {
  venta: "Venta",
  negativo: "Contacto negativo",
  no_efectivo: "Contacto no efectivo",
  no_contacto: "No contacto",
  sin_tipificar: "Sin tipificar",
};

const dayNum = (iso: string) => String(Number(iso.slice(8, 10)));
const share = (part: number, total: number) => (total ? (part / total) * 100 : 0);

function Missing({ campaign, what, month, icon }: { campaign: string; what: string; month: string | null; icon: LucideIcon }) {
  return (
    <EmptyState icon={icon} title={`Falta cargar ${what}${month ? ` de ${monthLabel(month)}` : ""}`}>
      <span>Cuando esté cargado en el </span>
      <Link to={`/carga?campana=${campaign}`} className="font-medium text-brand-600 hover:underline">
        Centro de carga
      </Link>
      <span>, aquí aparecen los análisis.</span>
    </EmptyState>
  );
}

const Stack = ({ children }: { children: ReactNode }) => <div className="space-y-6">{children}</div>;
const Pair = ({ children }: { children: ReactNode }) => <div className="grid gap-6 lg:grid-cols-2">{children}</div>;
/** Una línea de contexto debajo de una franja, en voz baja. */
const Aside = ({ children }: { children: ReactNode }) => <p className="px-1 text-[12.5px] leading-relaxed text-ink-faint">{children}</p>;

/* ---------- Ventas ---------- */

function VentasTab({ a }: { a: CampaignAnalysis }) {
  const v = a.ventas;
  if (!v) return <Missing campaign={a.campaign} what="la sábana" month={a.month} icon={TrendingUp} />;
  const parts = (["aprobado", "en_proceso", "rechazado"] as const).map((k) => ({
    label: SALE_LABEL[k]!,
    value: k === "aprobado" ? v.aprobadas : k === "rechazado" ? v.rechazadas : v.enProceso,
    color: SALE_COLORS[k]!,
  }));
  return (
    <Stack>
      <FigureStrip
        figures={[
          { label: `Ventas de ${monthLabel(a.month!)}`, value: fmtInt.format(v.total), foot: "Todas las de la sábana del banco", spark: v.porDia.map((d) => d.ventas) },
          { label: "Aprobadas", value: fmtInt.format(v.aprobadas), foot: `${fmtPct(share(v.aprobadas, v.total))} del total` },
          { label: "Rechazadas", value: fmtInt.format(v.rechazadas), foot: `${fmtPct(share(v.rechazadas, v.total))} del total` },
          { label: "En proceso", value: fmtInt.format(v.enProceso), foot: "Sin resolución del banco" },
          { label: "Aprobación", value: fmtPct(v.aprobacion), foot: "Sobre las ya resueltas" },
        ]}
      >
        <ShareBar parts={parts} label="Composición de las ventas por estatus del banco" />
      </FigureStrip>

      <ChartCard title="Ventas por día" note="Fecha de venta según la sábana. Pasa el cursor para ver las aprobadas de cada día.">
        <AreaChart
          seriesLabel="Ventas"
          data={v.porDia.map((d) => ({ key: d.date, label: dayNum(d.date), title: dayLabel(d.date), value: d.ventas, extra: [{ label: "aprobadas", value: fmtInt.format(d.aprobadas) }] }))}
        />
      </ChartCard>

      <Pair>
        <ChartCard title="Estatus del banco" note="Tal como viene en la sábana">
          <BarList rows={v.porEstatus.map((s) => ({ label: s.label, value: s.value, color: SALE_COLORS[s.class] }))} total={v.total} />
        </ChartCard>
        <ChartCard title="Motivos de rechazo" note={`${fmtInt.format(v.rechazadas)} ventas rechazadas`}>
          <BarList rows={v.rechazoPorMotivo.map((m) => ({ label: m.label, value: m.value, color: "var(--st-critical)" }))} total={v.rechazadas} />
        </ChartCard>
      </Pair>

      {v.porProceso.length > 1 && (
        <ChartCard title="Por proceso">
          <BarList rows={v.porProceso.map((p) => ({ label: p.label, value: p.value }))} total={v.total} />
        </ChartCard>
      )}

      <ChartCard title="Ejecutivos" note="Haz clic en un encabezado para reordenar">
        <DataTable
          rows={v.porEjecutivo}
          initialSort="ventas"
          cols={[
            { key: "agent", label: "Ejecutivo", render: (r) => r.agent, sort: (r) => r.agent },
            { key: "ventas", label: "Ventas", align: "right", render: (r) => fmtInt.format(r.ventas), sort: (r) => r.ventas },
            { key: "aprobadas", label: "Aprobadas", align: "right", render: (r) => fmtInt.format(r.aprobadas), sort: (r) => r.aprobadas },
            { key: "rechazadas", label: "Rechazadas", align: "right", render: (r) => fmtInt.format(r.rechazadas), sort: (r) => r.rechazadas },
            { key: "aprobacion", label: "Aprobación", align: "right", render: (r) => <PctCell value={r.aprobacion} />, sort: (r) => r.aprobacion },
          ]}
        />
      </ChartCard>

      {v.mensual.length > 1 && (
        <ChartCard title="Comparativo mensual" note="Cada mes con su sábana vigente">
          <Columns
            legend
            data={v.mensual.map((m) => ({
              key: m.month,
              label: monthShort(m.month),
              title: monthLabel(m.month),
              parts: [
                { label: "Aprobadas", value: m.aprobadas, color: SALE_COLORS.aprobado! },
                { label: "En proceso", value: m.enProceso, color: SALE_COLORS.en_proceso! },
                { label: "Rechazadas", value: m.rechazadas, color: SALE_COLORS.rechazado! },
              ],
              extra: [{ label: "aprobación", value: fmtPct(m.aprobacion) }],
            }))}
          />
          <div className="mt-8">
            <DataTable
              rows={[...v.mensual].reverse()}
              cols={[
                { key: "month", label: "Mes", render: (r) => <span className="block first-letter:uppercase">{monthLabel(r.month)}</span> },
                { key: "ventas", label: "Ventas", align: "right", render: (r) => fmtInt.format(r.ventas) },
                { key: "aprobadas", label: "Aprobadas", align: "right", render: (r) => fmtInt.format(r.aprobadas) },
                { key: "rechazadas", label: "Rechazadas", align: "right", render: (r) => fmtInt.format(r.rechazadas) },
                { key: "enProceso", label: "En proceso", align: "right", render: (r) => fmtInt.format(r.enProceso) },
                { key: "aprobacion", label: "Aprobación", align: "right", render: (r) => fmtPct(r.aprobacion) },
              ]}
            />
          </div>
        </ChartCard>
      )}
    </Stack>
  );
}

/* ---------- Base ---------- */

function BaseTab({ a }: { a: CampaignAnalysis }) {
  const b = a.base;
  if (!b) return <Missing campaign={a.campaign} what="la base" month={a.month} icon={Database} />;
  const label = (id: string) => getCampaign(a.campaign as CampaignCode).datasets.find((d) => d.id === id)?.label ?? id;
  const months = [...new Set(b.historial.map((h) => h.month))].sort();
  const datasets = [...new Set(b.historial.map((h) => h.dataset))];
  const colors = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];
  const conVenta = b.porPerfil.reduce((s, p) => s + p.conVenta, 0);
  const topPen = Math.max(...b.porPerfil.map((p) => p.penetracion), 0.0001);
  return (
    <Stack>
      <FigureStrip
        figures={[
          { label: "Clientes en la base", value: fmtInt.format(b.total), foot: b.porArchivo.length > 1 ? "Únicos, sin repetir entre bases" : "Clientes únicos" },
          ...b.porArchivo.map((f) => ({ label: label(f.dataset), value: fmtInt.format(f.unicos), foot: f.registros !== f.unicos ? `${fmtInt.format(f.registros)} filas en el archivo` : "Clientes únicos" })),
          ...(a.ventas ? [{ label: "Con venta en el mes", value: fmtInt.format(conVenta), foot: `${fmtPct(share(conVenta, b.total), 2)} de la base` }] : []),
        ]}
      />

      <ChartCard title="Perfiles de la base" note={a.ventas ? "Cruce por NIU contra la sábana del mismo mes" : "Carga la sábana del mes para ver el cruce contra ventas"}>
        <DataTable
          rows={b.porPerfil}
          initialSort="base"
          cols={[
            { key: "profile", label: "Perfil", render: (r) => r.profile, sort: (r) => r.profile },
            { key: "base", label: "Clientes", align: "right", render: (r) => fmtInt.format(r.base), sort: (r) => r.base },
            { key: "conVenta", label: "Con venta", align: "right", render: (r) => fmtInt.format(r.conVenta), sort: (r) => r.conVenta },
            { key: "penetracion", label: "Penetración", align: "right", render: (r) => <PctCell value={r.penetracion} max={topPen} digits={2} />, sort: (r) => r.penetracion },
            { key: "aprobadas", label: "Aprobadas", align: "right", render: (r) => fmtInt.format(r.aprobadas), sort: (r) => r.aprobadas },
            { key: "rechazadas", label: "Rechazadas", align: "right", render: (r) => fmtInt.format(r.rechazadas), sort: (r) => r.rechazadas },
          ]}
        />
      </ChartCard>

      {months.length > 1 && (
        <ChartCard title="Tamaño de la base por mes" note="Clientes únicos de cada archivo de base vigente">
          <Columns
            legend
            data={months.map((m) => ({
              key: m,
              label: monthShort(m),
              title: monthLabel(m),
              parts: datasets.map((ds, i) => ({ label: label(ds), value: b.historial.find((h) => h.month === m && h.dataset === ds)?.unicos ?? 0, color: colors[i % 3]! })),
            }))}
          />
        </ChartCard>
      )}
    </Stack>
  );
}

/* ---------- Efectividad ---------- */

function EfectividadTab({ a }: { a: CampaignAnalysis }) {
  const l = a.llamadas;
  if (!l) return <Missing campaign={a.campaign} what="las tipificaciones de VICI" month={a.month} icon={BarChart3} />;
  const base = a.base?.total ?? 0;
  const ranked = [...l.porAgente].sort((x, y) => y.contactabilidad - x.contactabilidad);
  return (
    <Stack>
      <FigureStrip
        figures={[
          {
            label: "Contactabilidad",
            value: fmtPct(l.contactabilidad),
            foot: `${fmtInt.format(l.efectivos)} de ${fmtInt.format(l.total)} llamadas con contacto efectivo`,
            spark: l.porDia.map((d) => (d.llamadas ? (d.efectivos / d.llamadas) * 100 : 0)),
          },
          { label: "Clientes llamados", value: fmtInt.format(l.registros), foot: base ? `${fmtPct(share(l.registros, base))} de la base` : "Sin base cargada" },
          { label: "Ventas en VICI", value: fmtInt.format(l.ventasUnicas), foot: "Clientes con venta tipificada" },
          { label: "Penetración", value: l.penetracion === null ? "—" : fmtPct(l.penetracion, 2), foot: base ? `Sobre ${fmtInt.format(base)} clientes de la base` : "Carga la base del mes" },
        ]}
      />
      <Aside>
        Contacto efectivo es venta, contacto negativo{l.reglaContacto === "con_no_efectivo" ? " y contacto no efectivo" : ""}, con la misma regla de la versión anterior.
      </Aside>

      <ChartCard title="Contactabilidad por agente" note="Llamadas con contacto efectivo sobre el total de llamadas de cada agente">
        <BarList
          rows={ranked.map((r) => ({ label: r.agent, value: r.contactabilidad, display: fmtPct(r.contactabilidad), note: `${fmtInt.format(r.efectivos)} de ${fmtInt.format(r.llamadas)}` }))}
          max={15}
        />
      </ChartCard>

      <ChartCard title="Detalle por agente">
        <DataTable
          rows={l.porAgente}
          initialSort="llamadas"
          cols={[
            { key: "agent", label: "Agente", render: (r) => r.agent, sort: (r) => r.agent },
            { key: "llamadas", label: "Llamadas", align: "right", render: (r) => fmtInt.format(r.llamadas), sort: (r) => r.llamadas },
            { key: "registros", label: "Clientes", align: "right", render: (r) => fmtInt.format(r.registros), sort: (r) => r.registros },
            ...(base ? [{ key: "pctBase", label: "De la base", align: "right" as const, render: (r: (typeof l.porAgente)[number]) => fmtPct(share(r.registros, base), 2), sort: (r: (typeof l.porAgente)[number]) => r.registros }] : []),
            { key: "efectivos", label: "Efectivos", align: "right", render: (r) => fmtInt.format(r.efectivos), sort: (r) => r.efectivos },
            { key: "contactabilidad", label: "Contactabilidad", align: "right", render: (r) => <PctCell value={r.contactabilidad} />, sort: (r) => r.contactabilidad },
            { key: "ventas", label: "Ventas", align: "right", render: (r) => fmtInt.format(r.ventas), sort: (r) => r.ventas },
          ]}
        />
      </ChartCard>
    </Stack>
  );
}

/* ---------- Llamadas ---------- */

function LlamadasTab({ a }: { a: CampaignAnalysis }) {
  const l = a.llamadas;
  const c = a.crm;
  if (!l && !c) return <Missing campaign={a.campaign} what="las tipificaciones de VICI" month={a.month} icon={PhoneCall} />;
  const byClass = (k: string) => l?.porClase.find((p) => p.label === k)?.value ?? 0;
  return (
    <Stack>
      {l && (
        <>
          <FigureStrip
            figures={[
              { label: "Llamadas del mes", value: fmtInt.format(l.total), foot: `A ${fmtInt.format(l.registros)} clientes distintos`, spark: l.porDia.map((d) => d.llamadas) },
              { label: "Ventas", value: fmtInt.format(byClass("venta")), foot: "Llamadas tipificadas como venta" },
              { label: "No contacto", value: fmtInt.format(byClass("no_contacto")), foot: `${fmtPct(share(byClass("no_contacto"), l.total))} de las llamadas` },
              { label: "Intentos por cliente", value: fmtNum(l.registros ? (l.primerContacto + l.seguimiento) / l.registros : 0), foot: "Promedio del mes" },
            ]}
          >
            <ShareBar parts={CALL_ORDER.map((k) => ({ label: CALL_LABEL[k]!, value: byClass(k), color: CALL_COLORS[k]! }))} label="Resultado de las llamadas" />
          </FigureStrip>

          <ChartCard title="Llamadas por día" note="Pasa el cursor para ver los contactos efectivos de cada día">
            <AreaChart
              seriesLabel="Llamadas"
              data={l.porDia.map((d) => ({
                key: d.date,
                label: dayNum(d.date),
                title: dayLabel(d.date),
                value: d.llamadas,
                extra: [
                  { label: "efectivas", value: fmtInt.format(d.efectivos) },
                  { label: "contactabilidad", value: fmtPct(share(d.efectivos, d.llamadas)) },
                ],
              }))}
            />
          </ChartCard>

          <Pair>
            <ChartCard title="Tipificaciones más frecuentes">
              <BarList rows={l.tipologias.map((t) => ({ label: t.label, value: t.value, color: CALL_COLORS[t.class] }))} total={l.total} />
            </ChartCard>
            <ChartCard title="Intentos por cliente" note="Cuántas veces se llamó a cada cliente en el mes">
              <Columns
                height={210}
                data={l.intentos.map((i) => ({
                  key: i.intentos,
                  label: i.intentos,
                  title: `${i.intentos} ${i.intentos === "1" ? "intento" : "intentos"}`,
                  parts: [{ label: "Clientes", value: i.clientes, color: "var(--viz-1)" }],
                }))}
              />
            </ChartCard>
          </Pair>

          <Pair>
            <ChartCard title="Primer contacto o seguimiento" note="Cada llamada, según si era la primera a ese cliente">
              <ShareBar
                parts={[
                  { label: "Primer contacto", value: l.primerContacto, color: "var(--viz-1)" },
                  { label: "Seguimiento", value: l.seguimiento, color: "var(--viz-2)" },
                ]}
              />
            </ChartCard>
            <ChartCard title="En qué intento se cerró la venta" note="Clientes con venta en VICI">
              <ShareBar
                parts={[
                  { label: "Al primer intento", value: l.ventasPrimerIntento, color: "var(--viz-1)" },
                  { label: "En un rellamado", value: l.ventasRellamado, color: "var(--viz-2)" },
                ]}
              />
            </ChartCard>
          </Pair>
        </>
      )}

      {c ? (
        <ChartCard
          title="Ventas capturadas en el CRM"
          note={c.conEstatusBanco === null ? "Carga la sábana para ver cuántas ya tienen estatus del banco" : `${fmtInt.format(c.conEstatusBanco)} de ${fmtInt.format(c.total)} ya aparecen en la sábana del banco`}
          actions={<span className="text-[26px] font-light tracking-[-0.02em] text-ink tabular-nums">{fmtInt.format(c.total)}</span>}
        >
          <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
            <AreaChart
              height={210}
              seriesLabel="Ventas en el CRM"
              data={c.porDia.map((d) => ({ key: d.date, label: dayNum(d.date), title: dayLabel(d.date), value: d.ventas }))}
            />
            <BarList rows={c.porAgente.map((r) => ({ label: r.label, value: r.value }))} total={c.total} max={8} />
          </div>
        </ChartCard>
      ) : (
        l && <Aside>Carga las ventas del CRM del mes para ver lo que capturaron los agentes antes del estatus del banco.</Aside>
      )}
    </Stack>
  );
}

/* ---------- Cumplimiento ---------- */

function GoalForm({ a, onDone, onCancel }: { a: CampaignAnalysis; onDone: () => void; onCancel?: () => void }) {
  const c = a.cumplimiento;
  const [meta, setMeta] = useState(c.meta?.toString() ?? "");
  const [agentes, setAgentes] = useState(c.agentes?.toString() ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSaving(true);
    try {
      await api.setGoal({ campaign: a.campaign, month: a.month!, salesGoal: Number(meta), agents: agentes ? Number(agentes) : null });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la meta.");
    } finally {
      setSaving(false);
    }
  };
  const input = "w-full rounded-xl border border-hair bg-paper px-3.5 py-2.5 text-sm text-ink tabular-nums outline-none focus:border-brand-500 focus:bg-white dark:focus:bg-slate-900";
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="block w-40 text-[13px]">
        <span className="mb-1.5 block text-ink-soft">Meta de ventas</span>
        <input className={input} type="number" min={0} step={1} required value={meta} onChange={(e) => setMeta(e.target.value)} />
      </label>
      <label className="block w-40 text-[13px]">
        <span className="mb-1.5 block text-ink-soft">Agentes</span>
        <input className={input} type="number" min={1} step={1} value={agentes} onChange={(e) => setAgentes(e.target.value)} placeholder="Opcional" />
      </label>
      <Button type="submit" loading={saving}>
        Guardar meta
      </Button>
      {onCancel && (
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>
      )}
      {error && (
        <div className="w-full">
          <ErrorMessage>{error}</ErrorMessage>
        </div>
      )}
    </form>
  );
}

function CumplimientoTab({ a, canEdit, refresh }: { a: CampaignAnalysis; canEdit: boolean; refresh: () => void }) {
  const c = a.cumplimiento;
  const [editing, setEditing] = useState(false);
  if (!a.month) return <Missing campaign={a.campaign} what="la sábana" month={null} icon={Target} />;
  const mes = monthLabel(a.month);
  const done = () => {
    setEditing(false);
    refresh();
  };

  if (c.meta === null || editing) {
    return (
      <Stack>
        <ChartCard title={c.meta === null ? `Meta de ${mes}` : `Editar la meta de ${mes}`} note={c.meta === null ? "Todavía no hay meta para este mes. Con la meta se calculan el avance, el ritmo y el gap por agente." : undefined}>
          {canEdit ? <GoalForm a={a} onDone={done} onCancel={c.meta === null ? undefined : () => setEditing(false)} /> : <p className="text-sm text-ink-soft">Un administrador debe registrar la meta del mes.</p>}
        </ChartCard>
        {!a.ventas && <Missing campaign={a.campaign} what="la sábana" month={a.month} icon={Target} />}
      </Stack>
    );
  }
  if (!a.ventas) return <Missing campaign={a.campaign} what="la sábana" month={a.month} icon={Target} />;

  const meta = c.meta;
  const esperado = (meta * c.diaDelMes) / (c.diasDelMes || 1);
  const adelante = c.ventas >= esperado;
  const proyTone = c.proyeccion >= meta ? "good" : "bad";
  return (
    <Stack>
      <FigureStrip
        actions={
          canEdit ? (
            <button onClick={() => setEditing(true)} className="text-[13px] font-medium text-brand-600 hover:underline">
              Editar meta
            </button>
          ) : undefined
        }
        figures={[
          {
            label: "Avance de la meta",
            value: fmtPct(c.avance),
            foot: `${fmtInt.format(c.ventas)} de ${fmtInt.format(meta)} ventas${c.agentes ? `, con ${c.agentes} agentes y ${fmtNum(c.metaPorAgente)} ventas cada uno` : ""}`,
            tone: c.faltan === 0 ? "good" : undefined,
          },
          { label: "Faltan", value: c.faltan === null ? "—" : fmtInt.format(c.faltan), foot: c.faltan === 0 ? "Meta alcanzada" : "Ventas para llegar a la meta", tone: c.faltan === 0 ? "good" : undefined },
          { label: "Ritmo actual", value: fmtNum(c.ritmoDiario), foot: `Ventas por día, al día ${c.diaDelMes} de ${c.diasDelMes}` },
          {
            label: "Ritmo necesario",
            value: c.ritmoNecesario === null ? "—" : fmtNum(c.ritmoNecesario),
            foot: "Ventas por día para cerrar en meta",
            tone: c.ritmoNecesario !== null && c.ritmoNecesario > c.ritmoDiario ? "warn" : undefined,
          },
          { label: "Proyección al cierre", value: fmtInt.format(c.proyeccion), foot: `${fmtPct(share(c.proyeccion, meta))} de la meta al ritmo actual`, tone: proyTone },
        ]}
      >
        <Meter thick value={c.ventas} max={meta} mark={esperado} markLabel={`Esperado al día ${c.diaDelMes}: ${fmtInt.format(Math.round(esperado))} ventas`} label="Avance contra la meta" />
        <p className="mt-3 text-[12.5px] text-ink-soft">
          La marca indica lo esperado al día {c.diaDelMes}: {fmtInt.format(Math.round(esperado))} ventas.{" "}
          <span className={adelante ? "text-[var(--st-good)]" : "text-[var(--st-critical)]"}>
            {adelante ? `Van ${fmtInt.format(Math.round(c.ventas - esperado))} por encima.` : `Van ${fmtInt.format(Math.round(esperado - c.ventas))} por debajo.`}
          </span>
        </p>
      </FigureStrip>

      <ChartCard title="Gap por agente" note={c.metaPorAgente === null ? "Registra el número de agentes para calcular la meta individual" : `Cada agente tiene una meta de ${fmtNum(c.metaPorAgente)} ventas`}>
        <DataTable
          rows={c.porAgente}
          initialSort="ventas"
          cols={[
            { key: "agent", label: "Agente", render: (r) => r.agent, sort: (r) => r.agent },
            { key: "ventas", label: "Ventas", align: "right", render: (r) => fmtInt.format(r.ventas), sort: (r) => r.ventas },
            { key: "aprobadas", label: "Aprobadas", align: "right", render: (r) => fmtInt.format(r.aprobadas), sort: (r) => r.aprobadas },
            { key: "meta", label: "Meta", align: "right", render: (r) => fmtNum(r.meta) },
            {
              key: "gap",
              label: "Gap",
              align: "right",
              render: (r) =>
                r.gap === null ? "—" : <span className={r.gap > 0 ? "text-[var(--st-critical)]" : "text-[var(--st-good)]"}>{r.gap > 0 ? `−${fmtNum(r.gap)}` : `+${fmtNum(-r.gap)}`}</span>,
              sort: (r) => r.gap ?? 0,
            },
            {
              key: "avance",
              label: "Avance",
              align: "right",
              render: (r) =>
                r.avance === null ? (
                  "—"
                ) : (
                  <span className="inline-flex items-center justify-end gap-3">
                    <span className="hidden w-20 sm:block">
                      <Meter value={r.ventas} max={r.meta ?? 0} />
                    </span>
                    <span className="w-11 tabular-nums">{fmtPct(r.avance, 0)}</span>
                  </span>
                ),
              sort: (r) => r.avance ?? 0,
            },
          ]}
        />
      </ChartCard>
    </Stack>
  );
}

/* ---------- página ---------- */

export function Campaign() {
  const { code = "", tab } = useParams();
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const requested = params.get("mes");
  const valid = isCampaignCode(code);
  const analysis = useQuery({ queryKey: ["analysis", code, requested], queryFn: () => api.analysis(code, requested), enabled: valid });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000 });

  if (!valid) return <Navigate to="/" replace />;
  const current = CAMPAIGN_TABS.find((t) => t.slug === tab);
  if (!current) return <Navigate to={`/campanas/${code}/ventas${requested ? `?mes=${requested}` : ""}`} replace />;
  const campaign = getCampaign(code);
  const a = analysis.data;
  const qs = a?.month ? `?mes=${a.month}` : "";

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={current.about}
        actions={
          <Link
            to={`/carga?campana=${code}`}
            className="inline-flex items-center gap-2 rounded-full border border-hair bg-white px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-ink-faint dark:bg-slate-900"
          >
            <Upload className="size-4 text-ink-soft" aria-hidden /> Cargar archivos
          </Link>
        }
      />

      <div className="mb-8 flex flex-col gap-4 border-b border-hair md:flex-row md:items-end md:justify-between">
        <div role="tablist" aria-label="Secciones de la campaña" className="-mb-px flex gap-6 overflow-x-auto">
          {CAMPAIGN_TABS.map((t) => (
            <NavLink
              key={t.slug}
              to={`/campanas/${code}/${t.slug}${qs}`}
              role="tab"
              aria-selected={t.slug === current.slug}
              className={({ isActive }) =>
                `border-b-2 pb-3 text-[14px] whitespace-nowrap transition-colors ${
                  isActive ? "border-ink font-medium text-ink dark:border-white" : "border-transparent text-ink-soft hover:text-ink"
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>

        {/* Mes */}
        {a && a.months.length > 0 && (
          <div className="mb-3 flex items-center gap-1 self-start overflow-x-auto rounded-full bg-hair/70 p-1 md:self-auto dark:bg-slate-800/70" role="group" aria-label="Mes">
            {a.months.map((m) => (
              <button
                key={m}
                onClick={() => setParams({ mes: m })}
                aria-pressed={m === a.month}
                className={`rounded-full px-3.5 py-1 text-[13px] whitespace-nowrap transition-colors first-letter:uppercase ${
                  m === a.month ? "bg-white font-medium text-ink shadow-[0_1px_2px_rgba(14,27,61,0.08)] dark:bg-slate-700" : "text-ink-soft hover:text-ink"
                }`}
              >
                {monthLabel(m)}
              </button>
            ))}
          </div>
        )}
      </div>

      {analysis.isPending && <p className="text-sm text-ink-soft">Calculando…</p>}
      {analysis.isError && <ErrorMessage>{analysis.error.message}</ErrorMessage>}
      {a && a.months.length === 0 && (
        <EmptyState icon={Upload} title="Esta campaña todavía no tiene archivos cargados">
          <span>Empieza por la sábana del mes en el </span>
          <Link to={`/carga?campana=${code}`} className="font-medium text-brand-600 hover:underline">
            Centro de carga
          </Link>
          <span>.</span>
        </EmptyState>
      )}
      {a && a.months.length > 0 && (
        <div className={analysis.isFetching ? "opacity-60 transition-opacity" : "transition-opacity"}>
          {current.slug === "ventas" && <VentasTab a={a} />}
          {current.slug === "base" && <BaseTab a={a} />}
          {current.slug === "efectividad" && <EfectividadTab a={a} />}
          {current.slug === "llamadas" && <LlamadasTab a={a} />}
          {current.slug === "cumplimiento" && (
            <CumplimientoTab a={a} canEdit={me.data?.permissions.includes("config:editar") ?? false} refresh={() => void qc.invalidateQueries({ queryKey: ["analysis", code] })} />
          )}
        </div>
      )}
    </>
  );
}
