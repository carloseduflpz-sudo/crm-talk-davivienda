/* Vista de una campaña: 5 pestañas sobre los archivos VIGENTES del mes, que se exploran:
   - filtro por agente (toda la vista se recalcula para esa persona),
   - clic en cualquier cifra, barra o día para ver los clientes que la forman,
   - comparación contra el mes anterior en indicadores y curvas,
   - mes y agente en el enlace, para compartir exactamente lo que se ve. */
import { getCampaign, isCampaignCode, type CampaignAnalysis, type CampaignCode } from "@crm/core";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Database, PhoneCall, Target, TrendingUp, Upload, type LucideIcon } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, useParams, useSearchParams } from "react-router";
import { AgentPicker } from "../components/AgentPicker";
import {
  AreaChart,
  BarList,
  ChartCard,
  Columns,
  DataTable,
  FigureStrip,
  Meter,
  PctCell,
  ShareBar,
  dayLabel,
  deltaOf,
  fmtInt,
  fmtNum,
  fmtPct,
  intOf,
  monthShort,
  type Compare,
} from "../components/charts";
import { ClientDetail, type DetailSpec } from "../components/ClientDetail";
import { GoalForm, joinY, workDaysText } from "../components/GoalForm";
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

const dayNum = (iso: string) => Number(iso.slice(8, 10));
const share = (part: number, total: number) => (total ? (part / total) * 100 : 0);
const pct1 = (n: number) => fmtPct(n);
const pct2 = (n: number) => fmtPct(n, 2);
const num1 = (n: number) => fmtNum(n);
/** Etiquetas del banco EN MAYÚSCULAS, en minúsculas para usarlas dentro de una frase. */
const lower = (s: string) => (s === s.toUpperCase() ? s.toLowerCase() : s.charAt(0).toLowerCase() + s.slice(1));
/** "vs agosto". */
const vsLabel = (prev: CampaignAnalysis | undefined) => (prev?.month ? `vs ${monthLabel(prev.month).split(" ")[0]}` : "");

/** Lo que cada pestaña necesita para ser interactiva. */
interface Ctx {
  a: CampaignAnalysis;
  /** Análisis del mes anterior (mismo agente), para comparar. */
  prev?: CampaignAnalysis;
  open: (spec: DetailSpec) => void;
  setAgent: (agent: string | null) => void;
  setMonth: (month: string) => void;
}

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

const Stack = ({ children }: { children: ReactNode }) => <div className="space-y-8">{children}</div>;
const Pair = ({ children }: { children: ReactNode }) => <div className="grid gap-8 xl:grid-cols-2">{children}</div>;
/** Una línea de contexto, en voz baja. */
const Aside = ({ children }: { children: ReactNode }) => <p className="px-1 text-[12.5px] leading-relaxed text-ink-faint">{children}</p>;

/** Serie del mes anterior por día del mes, para la línea punteada de referencia. */
function compareOf<T extends { date: string }>(prev: CampaignAnalysis | undefined, rows: T[] | undefined, value: (r: T) => number): Compare | undefined {
  if (!prev?.month || !rows?.length) return undefined;
  return { label: monthLabel(prev.month).split(" ")[0]!, byDay: Object.fromEntries(rows.map((r) => [dayNum(r.date), value(r)])) };
}

/* ---------- Ventas ---------- */

function VentasTab({ a, prev, open, setAgent, setMonth }: Ctx) {
  const v = a.ventas;
  if (!v) return <Missing campaign={a.campaign} what="la sábana" month={a.month} icon={TrendingUp} />;
  const p = prev?.ventas;
  const vs = vsLabel(prev);
  const parts = (["aprobado", "en_proceso", "rechazado"] as const).map((k) => ({
    key: k,
    label: SALE_LABEL[k]!,
    value: k === "aprobado" ? v.aprobadas : k === "rechazado" ? v.rechazadas : v.enProceso,
    color: SALE_COLORS[k]!,
  }));
  return (
    <Stack>
      <FigureStrip
        figures={[
          {
            label: `Ventas de ${monthLabel(a.month!)}`,
            num: v.total,
            format: intOf,
            foot: "Todas las de la sábana del banco",
            delta: deltaOf(v.total, p?.total, vs),
            spark: v.porDia.map((d) => d.ventas),
            onOpen: () => open({ fuente: "ventas", title: "Todas las ventas del mes" }),
          },
          {
            label: "Aprobadas",
            num: v.aprobadas,
            format: intOf,
            foot: `${fmtPct(share(v.aprobadas, v.total))} del total`,
            delta: deltaOf(v.aprobadas, p?.aprobadas, vs),
            onOpen: () => open({ fuente: "ventas", title: "Ventas aprobadas", filters: { clase: "aprobado" } }),
          },
          {
            label: "Rechazadas",
            num: v.rechazadas,
            format: intOf,
            foot: `${fmtPct(share(v.rechazadas, v.total))} del total`,
            delta: deltaOf(v.rechazadas, p?.rechazadas, vs, { upIsGood: false }),
            onOpen: () => open({ fuente: "ventas", title: "Ventas rechazadas", filters: { clase: "rechazado" } }),
          },
          {
            label: "En proceso",
            num: v.enProceso,
            format: intOf,
            foot: "Sin resolución del banco",
            delta: deltaOf(v.enProceso, p?.enProceso, vs, { upIsGood: null }),
            onOpen: () => open({ fuente: "ventas", title: "Ventas en proceso", filters: { clase: "en_proceso" } }),
          },
          { label: "Aprobación", num: v.aprobacion, format: pct1, foot: "Sobre las ya resueltas", delta: deltaOf(v.aprobacion, p?.aprobacion, vs, { rate: true }) },
        ]}
      >
        <ShareBar
          parts={parts}
          label="Composición de las ventas por estatus del banco"
          onSelect={(x) => open({ fuente: "ventas", title: `Ventas ${x.label.toLowerCase()}`, filters: { clase: parts.find((q) => q.label === x.label)!.key } })}
        />
      </FigureStrip>

      <ChartCard title="Ventas por día" note="Fecha de venta según la sábana. Haz clic en un día para ver sus ventas o arrastra para elegir varios.">
        <AreaChart
          seriesLabel="Ventas"
          unit="ventas"
          compare={compareOf(prev, p?.porDia, (d) => d.ventas)}
          data={v.porDia.map((d) => ({ key: d.date, day: dayNum(d.date), label: String(dayNum(d.date)), title: dayLabel(d.date), value: d.ventas, extra: [{ label: "aprobadas", value: fmtInt.format(d.aprobadas) }] }))}
          onOpenDay={(d) => open({ fuente: "ventas", title: `Ventas del ${d.title}`, filters: { dia: d.key } })}
          onOpenRange={(f, t) => open({ fuente: "ventas", title: `Ventas del ${f.title} al ${t.title}`, filters: { desde: f.key, hasta: t.key } })}
        />
      </ChartCard>

      <Pair>
        <ChartCard title="Estatus del banco" note="Tal como viene en la sábana. Clic para ver las ventas.">
          <BarList
            rows={v.porEstatus.map((s) => ({ label: s.label, value: s.value, color: SALE_COLORS[s.class] }))}
            total={v.total}
            onSelect={(r) => open({ fuente: "ventas", title: `Estatus ${lower(r.label)}`, filters: { estatus: r.label } })}
          />
        </ChartCard>
        <ChartCard title="Motivos de rechazo" note={`${fmtInt.format(v.rechazadas)} ventas rechazadas. Clic para ver cuáles.`}>
          <BarList
            rows={v.rechazoPorMotivo.map((m) => ({ label: m.label, value: m.value, color: "var(--st-critical)" }))}
            total={v.rechazadas}
            onSelect={(r) => open({ fuente: "ventas", title: `Rechazadas por ${lower(r.label)}`, filters: { motivo: r.label } })}
          />
        </ChartCard>
      </Pair>

      {v.porProceso.length > 1 && (
        <ChartCard title="Por proceso">
          <BarList rows={v.porProceso.map((x) => ({ label: x.label, value: x.value }))} total={v.total} onSelect={(r) => open({ fuente: "ventas", title: `Proceso ${r.label}`, filters: { proceso: r.label } })} />
        </ChartCard>
      )}

      <ChartCard title="Ejecutivos" note={a.agente ? "Clic en el ejecutivo para volver a ver a todos" : "Clic en un ejecutivo para ver toda la campaña solo con sus números"}>
        <DataTable
          rows={v.porEjecutivo}
          initialSort="ventas"
          onRowClick={(r) => setAgent(a.agente === r.agent ? null : r.agent)}
          rowHint="Filtrar la campaña por este ejecutivo"
          isActive={(r) => r.agent === a.agente}
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
        <ChartCard title="Comparativo mensual" note="Cada mes con su sábana vigente. Clic en un mes para verlo; en la leyenda puedes ocultar estatus.">
          <Columns
            legend
            active={a.month}
            onSelect={(d) => setMonth(d.key)}
            selectHint="Clic para ver este mes"
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
          <div className="mt-10">
            <DataTable
              rows={[...v.mensual].reverse()}
              onRowClick={(r) => setMonth(r.month)}
              rowHint="Ver este mes"
              isActive={(r) => r.month === a.month}
              cols={[
                { key: "month", label: "Mes", render: (r) => <span className="inline-block first-letter:uppercase">{monthLabel(r.month)}</span> },
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

function BaseTab({ a, prev, open, setMonth }: Ctx) {
  const b = a.base;
  if (!b) return <Missing campaign={a.campaign} what="la base" month={a.month} icon={Database} />;
  const label = (id: string) => getCampaign(a.campaign as CampaignCode).datasets.find((d) => d.id === id)?.label ?? id;
  const months = [...new Set(b.historial.map((h) => h.month))].sort();
  const datasets = [...new Set(b.historial.map((h) => h.dataset))];
  const colors = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)"];
  const conVenta = b.porPerfil.reduce((s, p) => s + p.conVenta, 0);
  const prevConVenta = prev?.base?.porPerfil.reduce((s, p) => s + p.conVenta, 0);
  const topPen = Math.max(...b.porPerfil.map((p) => p.penetracion), 0.0001);
  const vs = vsLabel(prev);
  return (
    <Stack>
      <FigureStrip
        figures={[
          {
            label: "Clientes en la base",
            num: b.total,
            format: intOf,
            foot: b.porArchivo.length > 1 ? "Únicos, sin repetir entre bases" : "Clientes únicos",
            delta: deltaOf(b.total, prev?.base?.total, vs, { upIsGood: null }),
            onOpen: () => open({ fuente: "base", title: "Clientes de la base" }),
          },
          ...b.porArchivo.map((f) => ({
            label: label(f.dataset),
            num: f.unicos,
            format: intOf,
            foot: f.registros !== f.unicos ? `${fmtInt.format(f.registros)} filas en el archivo` : "Clientes únicos",
          })),
          ...(a.ventas
            ? [
                {
                  label: a.agente ? `Con venta de ${a.agente}` : "Con venta en el mes",
                  num: conVenta,
                  format: intOf,
                  foot: `${fmtPct(share(conVenta, b.total), 2)} de la base`,
                  delta: deltaOf(conVenta, prevConVenta, vs),
                },
              ]
            : []),
        ]}
      />
      {a.agente && <Aside>La base es la misma para todos los agentes; el cruce de ventas sí está filtrado por {a.agente}.</Aside>}

      <ChartCard title="Perfiles de la base" note={a.ventas ? "Cruce por NIU contra la sábana del mismo mes. Clic en un perfil para ver sus clientes." : "Carga la sábana del mes para ver el cruce contra ventas"}>
        <DataTable
          rows={b.porPerfil}
          initialSort="base"
          onRowClick={(r) => open({ fuente: "base", title: `Perfil ${r.profile}`, filters: { perfil: r.profile } })}
          rowHint="Ver los clientes de este perfil"
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
        <ChartCard title="Tamaño de la base por mes" note="Clientes únicos de cada archivo de base vigente. Clic en un mes para verlo.">
          <Columns
            legend
            active={a.month}
            onSelect={(d) => setMonth(d.key)}
            selectHint="Clic para ver este mes"
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

function EfectividadTab({ a, prev, open, setAgent }: Ctx) {
  const l = a.llamadas;
  if (!l) return <Missing campaign={a.campaign} what="las tipificaciones de VICI" month={a.month} icon={BarChart3} />;
  const p = prev?.llamadas;
  const vs = vsLabel(prev);
  const base = a.base?.total ?? 0;
  const ranked = [...l.porAgente].sort((x, y) => y.contactabilidad - x.contactabilidad);
  return (
    <Stack>
      <FigureStrip
        figures={[
          {
            label: "Contactabilidad",
            num: l.contactabilidad,
            format: pct1,
            foot: `${fmtInt.format(l.efectivos)} de ${fmtInt.format(l.total)} llamadas con contacto efectivo`,
            delta: deltaOf(l.contactabilidad, p?.contactabilidad, vs, { rate: true }),
            spark: l.porDia.map((d) => (d.llamadas ? (d.efectivos / d.llamadas) * 100 : 0)),
          },
          {
            label: "Clientes llamados",
            num: l.registros,
            format: intOf,
            foot: base ? `${fmtPct(share(l.registros, base))} de la base` : "Sin base cargada",
            delta: deltaOf(l.registros, p?.registros, vs),
          },
          {
            label: "Ventas en VICI",
            num: l.ventasUnicas,
            format: intOf,
            foot: "Clientes con venta tipificada",
            delta: deltaOf(l.ventasUnicas, p?.ventasUnicas, vs),
            onOpen: () => open({ fuente: "llamadas", title: "Llamadas con venta", filters: { clase: "venta" } }),
          },
          l.penetracion === null
            ? { label: "Penetración", value: "—", foot: "Carga la base del mes" }
            : { label: "Penetración", num: l.penetracion, format: pct2, foot: `Sobre ${fmtInt.format(base)} clientes de la base`, delta: deltaOf(l.penetracion, p?.penetracion, vs, { rate: true }) },
        ]}
      />
      <Aside>Contacto efectivo es venta, contacto negativo{l.reglaContacto === "con_no_efectivo" ? " y contacto no efectivo" : ""}, con la misma regla de la versión anterior.</Aside>

      <ChartCard title="Contactabilidad por agente" note="Llamadas con contacto efectivo sobre el total de llamadas de cada agente. Clic en un agente para filtrar la campaña.">
        <BarList
          rows={ranked.map((r) => ({ label: r.agent, value: r.contactabilidad, display: fmtPct(r.contactabilidad), note: `${fmtInt.format(r.efectivos)} de ${fmtInt.format(r.llamadas)}` }))}
          max={12}
          active={a.agente}
          selectHint="Filtrar por"
          onSelect={(r) => setAgent(a.agente === r.label ? null : r.label)}
        />
      </ChartCard>

      <ChartCard title="Detalle por agente">
        <DataTable
          rows={l.porAgente}
          initialSort="llamadas"
          onRowClick={(r) => setAgent(a.agente === r.agent ? null : r.agent)}
          rowHint="Filtrar la campaña por este agente"
          isActive={(r) => r.agent === a.agente}
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

type Llamadas = NonNullable<CampaignAnalysis["llamadas"]>;

function LlamadasTab({ a, prev, open, setAgent }: Ctx) {
  const l = a.llamadas;
  const c = a.crm;
  if (!l && !c) return <Missing campaign={a.campaign} what="las tipificaciones de VICI" month={a.month} icon={PhoneCall} />;
  const p = prev?.llamadas ?? undefined;
  const vs = vsLabel(prev);
  const byClass = (k: string, from: Llamadas | null | undefined = l) => from?.porClase.find((x) => x.label === k)?.value ?? 0;
  const intentos = (x: Llamadas) => (x.registros ? (x.primerContacto + x.seguimiento) / x.registros : 0);
  return (
    <Stack>
      {l && (
        <>
          <FigureStrip
            figures={[
              {
                label: "Llamadas del mes",
                num: l.total,
                format: intOf,
                foot: `A ${fmtInt.format(l.registros)} clientes distintos`,
                delta: deltaOf(l.total, p?.total, vs, { upIsGood: null }),
                spark: l.porDia.map((d) => d.llamadas),
                onOpen: () => open({ fuente: "llamadas", title: "Todas las llamadas del mes" }),
              },
              {
                label: "Ventas",
                num: byClass("venta"),
                format: intOf,
                foot: "Llamadas tipificadas como venta",
                delta: p ? deltaOf(byClass("venta"), byClass("venta", p), vs) : undefined,
                onOpen: () => open({ fuente: "llamadas", title: "Llamadas con venta", filters: { clase: "venta" } }),
              },
              {
                label: "No contacto",
                num: byClass("no_contacto"),
                format: intOf,
                foot: `${fmtPct(share(byClass("no_contacto"), l.total))} de las llamadas`,
                delta: p ? deltaOf(share(byClass("no_contacto"), l.total), share(byClass("no_contacto", p), p.total), vs, { rate: true, upIsGood: false }) : undefined,
                onOpen: () => open({ fuente: "llamadas", title: "Llamadas sin contacto", filters: { clase: "no_contacto" } }),
              },
              { label: "Intentos por cliente", num: intentos(l), format: num1, foot: "Promedio del mes", delta: p ? deltaOf(intentos(l), intentos(p), vs, { upIsGood: null }) : undefined },
            ]}
          >
            <ShareBar
              parts={CALL_ORDER.map((k) => ({ label: CALL_LABEL[k]!, value: byClass(k), color: CALL_COLORS[k]! }))}
              label="Resultado de las llamadas"
              onSelect={(x) => {
                const k = CALL_ORDER.find((q) => CALL_LABEL[q] === x.label)!;
                open({ fuente: "llamadas", title: `Llamadas: ${x.label.toLowerCase()}`, filters: { clase: k } });
              }}
            />
          </FigureStrip>

          <ChartCard title="Llamadas por día" note="Haz clic en un día para ver sus llamadas o arrastra para elegir varios.">
            <AreaChart
              seriesLabel="Llamadas"
              compare={compareOf(prev, p?.porDia, (d) => d.llamadas)}
              data={l.porDia.map((d) => ({
                key: d.date,
                day: dayNum(d.date),
                label: String(dayNum(d.date)),
                title: dayLabel(d.date),
                value: d.llamadas,
                extra: [
                  { label: "efectivas", value: fmtInt.format(d.efectivos) },
                  { label: "contactabilidad", value: fmtPct(share(d.efectivos, d.llamadas)) },
                ],
              }))}
              onOpenDay={(d) => open({ fuente: "llamadas", title: `Llamadas del ${d.title}`, filters: { dia: d.key } })}
              onOpenRange={(f, t) => open({ fuente: "llamadas", title: `Llamadas del ${f.title} al ${t.title}`, filters: { desde: f.key, hasta: t.key } })}
            />
          </ChartCard>

          <Pair>
            <ChartCard title="Tipificaciones más frecuentes" note="Clic para ver las llamadas">
              <BarList
                rows={l.tipologias.map((t) => ({ label: t.label, value: t.value, color: CALL_COLORS[t.class] }))}
                total={l.total}
                onSelect={(r) => open({ fuente: "llamadas", title: `Tipificación ${lower(r.label)}`, filters: { tipologia: r.label } })}
              />
            </ChartCard>
            <ChartCard title="Intentos por cliente" note="Cuántas veces se llamó a cada cliente en el mes">
              <Columns
                height={260}
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
          actions={
            <button type="button" onClick={() => open({ fuente: "crm", title: "Ventas capturadas en el CRM" })} className="group text-right" title="Ver las ventas capturadas">
              <span className="block text-[26px] leading-none font-light tracking-[-0.02em] text-ink tabular-nums transition-colors group-hover:text-brand-600">{fmtInt.format(c.total)}</span>
            </button>
          }
        >
          <div className="grid gap-12 xl:grid-cols-[1.4fr_1fr]">
            <AreaChart
              height={260}
              seriesLabel="Ventas en el CRM"
              unit="ventas"
              compare={compareOf(prev, prev?.crm?.porDia, (d) => d.ventas)}
              data={c.porDia.map((d) => ({ key: d.date, day: dayNum(d.date), label: String(dayNum(d.date)), title: dayLabel(d.date), value: d.ventas }))}
              onOpenDay={(d) => open({ fuente: "crm", title: `Ventas capturadas el ${d.title}`, filters: { dia: d.key } })}
              onOpenRange={(f, t) => open({ fuente: "crm", title: `Ventas capturadas del ${f.title} al ${t.title}`, filters: { desde: f.key, hasta: t.key } })}
            />
            <BarList rows={c.porAgente.map((r) => ({ label: r.label, value: r.value }))} total={c.total} max={8} active={a.agente} selectHint="Filtrar por" onSelect={(r) => setAgent(a.agente === r.label ? null : r.label)} />
          </div>
        </ChartCard>
      ) : (
        l && <Aside>Carga las ventas del CRM del mes para ver lo que capturaron los agentes antes del estatus del banco.</Aside>
      )}
    </Stack>
  );
}

/* ---------- Cumplimiento ---------- */

function CumplimientoTab({ a, open, setAgent, canEdit, refresh }: Ctx & { canEdit: boolean; refresh: () => void }) {
  const c = a.cumplimiento;
  const [editing, setEditing] = useState(false);
  if (!a.month) return <Missing campaign={a.campaign} what="la sábana" month={null} icon={Target} />;
  const mes = monthLabel(a.month);
  const done = () => {
    setEditing(false);
    refresh();
  };
  const contados = joinY(c.config.estatus.map((x) => x.toLowerCase()));
  const feriados = joinY(c.config.feriados.map((d) => String(Number(d.slice(8)))));
  const reglas = `${contados ? `Cuentan los estatus ${contados}.` : "No hay estatus elegidos para la meta."} Se trabaja de ${workDaysText(c.config.diasSemana)}${feriados ? `, sin el ${feriados}` : ""}: ${c.diasDelMes} días hábiles en el mes.`;

  if (c.meta === null || editing) {
    return (
      <Stack>
        <ChartCard
          title={c.meta === null ? `Meta de ${mes}` : `Editar la meta de ${mes}`}
          note={
            a.agente
              ? `Para ver la meta individual de ${a.agente}, registra la meta del mes y el número de agentes con el filtro quitado.`
              : c.meta === null
                ? "Todavía no hay meta para este mes. Con la meta se calculan el avance, el ritmo en días hábiles y el gap por agente."
                : undefined
          }
        >
          {a.agente ? (
            <Button variant="secondary" onClick={() => setAgent(null)}>
              Ver todos los agentes
            </Button>
          ) : canEdit ? (
            <GoalForm a={a} onDone={done} onCancel={c.meta === null ? undefined : () => setEditing(false)} />
          ) : (
            <p className="text-sm text-ink-soft">Un administrador debe registrar la meta del mes.</p>
          )}
        </ChartCard>
        {!a.ventas && <Missing campaign={a.campaign} what="la sábana" month={a.month} icon={Target} />}
      </Stack>
    );
  }
  if (!a.ventas) return <Missing campaign={a.campaign} what="la sábana" month={a.month} icon={Target} />;

  const meta = c.meta;
  const esperado = c.esperado ?? 0;
  const adelante = c.ventas >= esperado;
  const corte = c.fechaCorte ? dayLabel(c.fechaCorte) : null;
  const openCounted = () => open({ fuente: "ventas", title: "Ventas que cuentan para la meta", filters: { estatus: c.config.estatus } });
  return (
    <Stack>
      <FigureStrip
        actions={
          canEdit && !a.agente ? (
            <button onClick={() => setEditing(true)} className="text-[13px] font-medium text-brand-600 hover:underline">
              Editar meta
            </button>
          ) : undefined
        }
        figures={[
          {
            label: a.agente ? `Avance de ${a.agente}` : "Avance de la meta",
            num: c.avance ?? 0,
            format: pct1,
            foot: (
              <>
                {fmtInt.format(c.ventas)} de {a.agente ? fmtNum(meta) : fmtInt.format(meta)} ventas que cuentan
                {c.ventasTotales !== c.ventas && <> ({fmtInt.format(c.ventasTotales)} en la sábana)</>}
                {!a.agente && c.agentes ? `, ${c.agentes} agentes con ${fmtNum(c.metaPorAgente)} cada uno` : ""}
              </>
            ),
            tone: c.faltan === 0 ? "good" : undefined,
          },
          {
            label: "Faltan",
            num: c.faltan ?? 0,
            format: num1,
            foot: c.faltan === 0 ? "Meta alcanzada" : "Ventas para llegar a la meta",
            tone: c.faltan === 0 ? "good" : undefined,
          },
          { label: "Ritmo actual", num: c.ritmoDiario, format: num1, foot: `Ventas por día hábil, en ${c.diaDelMes} de ${c.diasDelMes} días hábiles` },
          c.ritmoNecesario === null
            ? { label: "Ritmo necesario", value: "—", foot: "Ya no quedan días hábiles" }
            : {
                label: "Ritmo necesario",
                num: c.ritmoNecesario,
                format: num1,
                foot: `Por día hábil en los ${c.diasRestantes} que quedan`,
                tone: c.ritmoNecesario > c.ritmoDiario ? ("warn" as const) : undefined,
              },
          { label: "Proyección al cierre", num: c.proyeccion, format: intOf, foot: `${fmtPct(share(c.proyeccion, meta))} de la meta al ritmo actual`, tone: c.proyeccion >= meta ? "good" : "bad" },
        ]}
      >
        <Meter thick value={c.ventas} max={meta} mark={esperado} markLabel={`Esperado al ${corte ?? "corte"}: ${fmtNum(esperado, 0)} ventas`} label="Avance contra la meta" />
        <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">
          {corte ? (
            <>
              Corte de la sábana: {corte}, día hábil {c.diaDelMes} de {c.diasDelMes}. La marca indica lo esperado a esa fecha: {fmtNum(esperado, 0)} ventas.{" "}
              <span className={adelante ? "text-[var(--st-good)]" : "text-[var(--st-critical)]"}>
                {adelante ? `Van ${fmtNum(c.ventas - esperado, 0)} por encima.` : `Van ${fmtNum(esperado - c.ventas, 0)} por debajo.`}
              </span>
            </>
          ) : (
            "La sábana del mes no trae fechas de venta."
          )}
        </p>
        <p className="mt-1.5 text-[12.5px] text-ink-faint">
          {reglas}{" "}
          <button type="button" onClick={openCounted} className="font-medium text-brand-600 hover:underline">
            Ver las ventas que cuentan
          </button>
        </p>
      </FigureStrip>

      <ChartCard
        title="Gap por agente"
        note={c.metaPorAgente === null ? "Registra el número de agentes para calcular la meta individual" : `Cada agente tiene una meta de ${fmtNum(c.metaPorAgente)} ventas que cuentan. Clic en un agente para filtrar la campaña.`}
      >
        <DataTable
          rows={c.porAgente}
          initialSort="ventas"
          onRowClick={(r) => setAgent(a.agente === r.agent ? null : r.agent)}
          rowHint="Filtrar la campaña por este agente"
          isActive={(r) => r.agent === a.agente}
          cols={[
            { key: "agent", label: "Agente", render: (r) => r.agent, sort: (r) => r.agent },
            { key: "ventas", label: "Cuentan", align: "right", render: (r) => fmtInt.format(r.ventas), sort: (r) => r.ventas },
            { key: "total", label: "En la sábana", align: "right", render: (r) => fmtInt.format(r.total), sort: (r) => r.total },
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
  const agent = params.get("agente") || null;
  const valid = isCampaignCode(code);
  const analysis = useQuery({
    queryKey: ["analysis", code, requested, agent],
    queryFn: () => api.analysis(code, requested, agent),
    enabled: valid,
    // Al cambiar de mes o de agente se queda lo anterior en pantalla hasta que llega lo nuevo.
    placeholderData: keepPreviousData,
  });
  const a = analysis.data;
  const prevMonth = a?.month ? a.months[a.months.indexOf(a.month) + 1] : undefined;
  const prev = useQuery({
    queryKey: ["analysis", code, prevMonth ?? null, agent],
    queryFn: () => api.analysis(code, prevMonth, agent),
    enabled: valid && Boolean(prevMonth),
    staleTime: 60_000,
  });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000 });
  const [detail, setDetail] = useState<DetailSpec | null>(null);

  const setQuery = useCallback(
    (next: { mes?: string | null; agente?: string | null }) => {
      const mes = next.mes === undefined ? (a?.month ?? requested) : next.mes;
      const agente = next.agente === undefined ? agent : next.agente;
      const q: Record<string, string> = {};
      if (mes) q.mes = mes;
      if (agente) q.agente = agente;
      setParams(q);
    },
    [a?.month, requested, agent, setParams],
  );
  const closeDetail = useCallback(() => setDetail(null), []);

  if (!valid) return <Navigate to="/" replace />;
  const current = CAMPAIGN_TABS.find((t) => t.slug === tab);
  if (!current) return <Navigate to={`/campanas/${code}/ventas${requested ? `?mes=${requested}` : ""}`} replace />;
  const campaign = getCampaign(code);
  const qsParams = new URLSearchParams();
  if (a?.month) qsParams.set("mes", a.month);
  if (agent) qsParams.set("agente", agent);
  const qs = qsParams.toString() ? `?${qsParams}` : "";
  const ctx: Ctx | null = a
    ? {
        a,
        prev: prevMonth && prev.data?.month === prevMonth ? prev.data : undefined,
        open: setDetail,
        setAgent: (x) => setQuery({ agente: x }),
        setMonth: (m) => setQuery({ mes: m }),
      }
    : null;

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

      <div className="mb-8 border-b border-hair">
        <div role="tablist" aria-label="Secciones de la campaña" className="-mb-px flex gap-6 overflow-x-auto">
          {CAMPAIGN_TABS.map((t) => (
            <NavLink
              key={t.slug}
              to={`/campanas/${code}/${t.slug}${qs}`}
              role="tab"
              aria-selected={t.slug === current.slug}
              className={({ isActive }) =>
                `border-b-2 pb-3 text-[14px] whitespace-nowrap transition-colors ${isActive ? "border-ink font-medium text-ink dark:border-white" : "border-transparent text-ink-soft hover:text-ink"}`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </div>
      </div>

      {a && a.months.length > 0 && (
        <div className="-mt-2 mb-10 flex flex-wrap items-center justify-between gap-3">
          <AgentPicker agents={a.agentes} value={agent} onChange={(x) => setQuery({ agente: x })} />
          <div className="flex max-w-full items-center gap-1 overflow-x-auto rounded-full bg-hair/70 p-1 dark:bg-slate-800/70" role="group" aria-label="Mes">
            {a.months.map((m) => (
              <button
                key={m}
                onClick={() => setQuery({ mes: m })}
                aria-pressed={m === a.month}
                className={`rounded-full px-3.5 py-1 text-[13px] whitespace-nowrap transition-colors first-letter:uppercase ${
                  m === a.month ? "bg-white font-medium text-ink shadow-[0_1px_2px_rgba(14,27,61,0.08)] dark:bg-slate-700" : "text-ink-soft hover:text-ink"
                }`}
              >
                {monthLabel(m)}
              </button>
            ))}
          </div>
        </div>
      )}

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
      {ctx && ctx.a.months.length > 0 && (
        <div className={analysis.isFetching ? "opacity-70 transition-opacity duration-300" : "transition-opacity duration-300"} aria-busy={analysis.isFetching}>
          {current.slug === "ventas" && <VentasTab {...ctx} />}
          {current.slug === "base" && <BaseTab {...ctx} />}
          {current.slug === "efectividad" && <EfectividadTab {...ctx} />}
          {current.slug === "llamadas" && <LlamadasTab {...ctx} />}
          {current.slug === "cumplimiento" && (
            <CumplimientoTab {...ctx} canEdit={me.data?.permissions.includes("config:editar") ?? false} refresh={() => void qc.invalidateQueries({ queryKey: ["analysis", code] })} />
          )}
        </div>
      )}

      {detail && a?.month && <ClientDetail campaign={code} month={a.month} agent={agent} spec={detail} onClose={closeDetail} />}
    </>
  );
}
