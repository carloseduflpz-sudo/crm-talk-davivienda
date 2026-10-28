/* Vista de una campaña: 5 pestañas sobre los archivos VIGENTES del mes, que se exploran:
   - filtro por agente (toda la vista se recalcula para esa persona),
   - clic en cualquier cifra, barra o día para ver los clientes que la forman,
   - comparación contra el mes anterior en indicadores y curvas,
   - mes y agente en el enlace, para compartir exactamente lo que se ve. */
import { GOAL_UNIT, getCampaign, isCampaignCode, type CampaignAnalysis, type CampaignCode, type MonthSummary } from "@crm/core";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Database, History, PhoneCall, Target, TrendingUp, TriangleAlert, Upload, type LucideIcon } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { Link, NavLink, Navigate, useParams, useSearchParams } from "react-router";
import { AgentPicker } from "../components/AgentPicker";
import {
  AreaChart,
  BarList,
  ChartCard,
  Columns,
  DeltaBadge,
  Panel,
  DataTable,
  FigureStrip,
  Meter,
  PctCell,
  ShareBar,
  dayLabel,
  deltaOf,
  fmtInt,
  fmtMoney,
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
import { consultaAnalisis, consultaHistorico, mesAnterior } from "../lib/consultas";
import { currentMonth, monthLabel } from "../lib/xlsx";

export const CAMPAIGN_TABS = [
  { slug: "ventas", label: "Ventas", icon: TrendingUp, needs: "sabana", about: "Estatus del banco, rechazo por motivo, ejecutivos y comparativo mensual." },
  { slug: "base", label: "Base", icon: Database, needs: "base", about: "Clientes de la base, perfiles y penetración contra la sábana." },
  { slug: "efectividad", label: "Efectividad", icon: BarChart3, needs: "tipif", about: "Contactabilidad, registros y penetración, general y por agente." },
  { slug: "llamadas", label: "Llamadas", icon: PhoneCall, needs: "tipif", about: "Tipificaciones, intentos por cliente y ventas capturadas en el CRM." },
  { slug: "cumplimiento", label: "Cumplimiento", icon: Target, needs: "sabana", about: "Meta, avance, ritmo, proyección y gap por agente." },
  { slug: "historico", label: "Histórico", icon: History, needs: "sabana", about: "Comparativo mes a mes: ventas, base, contactabilidad, penetración y cumplimiento." },
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
/** "vs septiembre"; si el mes que se ve va en curso, se aclara que el anterior está completo. */
const vsLabel = (prev: CampaignAnalysis | undefined, a: CampaignAnalysis) =>
  prev?.month ? `vs ${monthLabel(prev.month).split(" ")[0]}${a.month === currentMonth() ? " completo" : ""}` : "";

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
  // Solo los días de ese mes (la sábana trae también ventas de meses anteriores: la cosecha).
  const month = prev.month;
  return { label: monthLabel(month).split(" ")[0]!, byDay: Object.fromEntries(rows.filter((r) => r.date.startsWith(month)).map((r) => [dayNum(r.date), value(r)])) };
}

/* ---------- Ventas ---------- */

function VentasTab({ a, prev, open, setAgent, setMonth }: Ctx) {
  const v = a.ventas;
  if (!v) return <Missing campaign={a.campaign} what="la sábana" month={a.month} icon={TrendingUp} />;
  const p = prev?.ventas;
  const vs = vsLabel(prev, a);
  // Mes en curso: el total y las aprobadas se comparan contra el mes anterior al mismo día.
  const corte = a.month === currentMonth() && a.fechas.hasta ? dayNum(a.fechas.hasta) : null;
  // Por día solo cuentan las fechas del mes; las ventas de meses anteriores (cosecha) van aparte.
  const days = v.porDia.filter((d) => d.date.startsWith(a.month!));
  const pDays = p && corte && prev?.month ? p.porDia.filter((d) => d.date.startsWith(prev.month!) && dayNum(d.date) <= corte) : null;
  const pSum = (k: "ventas" | "aprobadas" | "monto" | "montoAprobado") => (pDays ? pDays.reduce((t, d) => t + d[k], 0) : undefined);
  const cSum = (k: "ventas" | "aprobadas" | "monto" | "montoAprobado") => days.reduce((t, d) => t + d[k], 0);
  const vsDay = pDays && prev?.month ? `vendidas en el mes vs ${monthLabel(prev.month).split(" ")[0]} al día ${corte}` : vs;
  const cosechaTxt = v.cosecha.total ? `${fmtInt.format(v.cosecha.total)} de meses anteriores (cosecha)` : "";
  // CDC y Extra: los indicadores van en dólares (con la cantidad de ventas como referencia).
  const money = isCampaignCode(a.campaign) && GOAL_UNIT[a.campaign] === "monto";
  const parts = (["aprobado", "en_proceso", "rechazado"] as const).map((k) => ({
    key: k,
    label: SALE_LABEL[k]!,
    value: money
      ? k === "aprobado"
        ? v.monto.aprobado
        : k === "rechazado"
          ? v.monto.rechazado
          : v.monto.enProceso
      : k === "aprobado"
        ? v.aprobadas
        : k === "rechazado"
          ? v.rechazadas
          : v.enProceso,
    color: SALE_COLORS[k]!,
  }));
  const ventasN = (n: number) => `${fmtInt.format(n)} ${n === 1 ? "venta" : "ventas"}`;
  return (
    <Stack>
      <FigureStrip
        figures={[
          money
            ? {
                label: `Monto de ${monthLabel(a.month!)}`,
                num: v.monto.total,
                format: fmtMoney,
                foot: `${ventasN(v.total)} en la sábana del banco${cosechaTxt ? `; ${cosechaTxt}` : ""}`,
                delta: pDays ? deltaOf(cSum("monto"), pSum("monto"), vsDay) : deltaOf(v.monto.total, p?.monto.total, vs),
                spark: days.map((d) => d.monto),
                onOpen: () => open({ fuente: "ventas", title: "Todas las ventas del mes" }),
              }
            : {
                label: `Ventas de ${monthLabel(a.month!)}`,
                num: v.total,
                format: intOf,
                foot: cosechaTxt ? `Toda la sábana del banco, con ${cosechaTxt}` : "Todas las de la sábana del banco",
                delta: pDays ? deltaOf(cSum("ventas"), pSum("ventas"), vsDay) : deltaOf(v.total, p?.total, vs),
                spark: days.map((d) => d.ventas),
                onOpen: () => open({ fuente: "ventas", title: "Todas las ventas del mes" }),
              },
          {
            label: "Aprobadas",
            num: money ? v.monto.aprobado : v.aprobadas,
            format: money ? fmtMoney : intOf,
            foot: money ? `${ventasN(v.aprobadas)}, ${fmtPct(share(v.monto.aprobado, v.monto.total))} del monto` : `${fmtPct(share(v.aprobadas, v.total))} del total`,
            delta: pDays
              ? money
                ? deltaOf(cSum("montoAprobado"), pSum("montoAprobado"), vsDay)
                : deltaOf(cSum("aprobadas"), pSum("aprobadas"), vsDay)
              : money
                ? deltaOf(v.monto.aprobado, p?.monto.aprobado, vs)
                : deltaOf(v.aprobadas, p?.aprobadas, vs),
            onOpen: () => open({ fuente: "ventas", title: "Ventas aprobadas", filters: { clase: "aprobado" } }),
          },
          {
            label: "Rechazadas",
            num: money ? v.monto.rechazado : v.rechazadas,
            format: money ? fmtMoney : intOf,
            foot: money ? `${ventasN(v.rechazadas)}, ${fmtPct(share(v.monto.rechazado, v.monto.total))} del monto` : `${fmtPct(share(v.rechazadas, v.total))} del total`,
            delta: money ? deltaOf(v.monto.rechazado, p?.monto.rechazado, vs, { upIsGood: false }) : deltaOf(v.rechazadas, p?.rechazadas, vs, { upIsGood: false }),
            onOpen: () => open({ fuente: "ventas", title: "Ventas rechazadas", filters: { clase: "rechazado" } }),
          },
          {
            label: "En proceso",
            num: money ? v.monto.enProceso : v.enProceso,
            format: money ? fmtMoney : intOf,
            foot: money ? `${ventasN(v.enProceso)} sin resolución del banco` : "Sin resolución del banco",
            delta: money ? deltaOf(v.monto.enProceso, p?.monto.enProceso, vs, { upIsGood: null }) : deltaOf(v.enProceso, p?.enProceso, vs, { upIsGood: null }),
            onOpen: () => open({ fuente: "ventas", title: "Ventas en proceso", filters: { clase: "en_proceso" } }),
          },
          { label: "Aprobación", num: v.aprobacion, format: pct1, foot: "Sobre las ya resueltas", delta: deltaOf(v.aprobacion, p?.aprobacion, vs, { rate: true }) },
        ]}
      >
        <ShareBar
          parts={parts}
          format={money ? fmtMoney : intOf}
          label={money ? "Composición del monto por estatus del banco" : "Composición de las ventas por estatus del banco"}
          onSelect={(x) => open({ fuente: "ventas", title: `Ventas ${x.label.toLowerCase()}`, filters: { clase: parts.find((q) => q.label === x.label)!.key } })}
        />
      </FigureStrip>

      <ChartCard
        title={money ? "Monto por día" : "Ventas por día"}
        note={`Fecha de venta según la sábana${cosechaTxt ? `; no incluye ${cosechaTxt}` : ""}. Haz clic en un día para ver sus ventas o arrastra para elegir varios.`}
      >
        <AreaChart
          seriesLabel={money ? "Monto" : "Ventas"}
          unit={money ? "monto" : "ventas"}
          format={money ? fmtMoney : undefined}
          tickPrefix={money ? "$" : ""}
          compare={compareOf(prev, p?.porDia, (d) => (money ? d.monto : d.ventas))}
          data={days.map((d) => ({
            key: d.date,
            day: dayNum(d.date),
            label: String(dayNum(d.date)),
            title: dayLabel(d.date),
            value: money ? d.monto : d.ventas,
            extra: money
              ? [
                  { label: "aprobado", value: fmtMoney(d.montoAprobado) },
                  { label: d.ventas === 1 ? "venta" : "ventas", value: fmtInt.format(d.ventas) },
                ]
              : [{ label: "aprobadas", value: fmtInt.format(d.aprobadas) }],
          }))}
          onOpenDay={(d) => open({ fuente: "ventas", title: `Ventas del ${d.title}`, filters: { dia: d.key } })}
          onOpenRange={(f, t) => open({ fuente: "ventas", title: `Ventas del ${f.title} al ${t.title}`, filters: { desde: f.key, hasta: t.key } })}
        />
      </ChartCard>

      <Pair>
        <ChartCard title="Estatus del banco" note="Tal como viene en la sábana. Clic para ver las ventas.">
          <BarList
            rows={v.porEstatus.map((s) =>
              money
                ? { label: s.label, value: s.monto, display: fmtMoney(s.monto), note: ventasN(s.value), color: SALE_COLORS[s.class] }
                : { label: s.label, value: s.value, color: SALE_COLORS[s.class] },
            )}
            total={money ? v.monto.total : v.total}
            onSelect={(r) => open({ fuente: "ventas", title: `Estatus ${lower(r.label)}`, filters: { estatus: r.label } })}
          />
        </ChartCard>
        <ChartCard title="Motivos de rechazo" note={`${fmtInt.format(v.rechazadas)} ventas rechazadas. Clic para ver cuáles.`}>
          <BarList
            rows={v.rechazoPorMotivo.map((m) =>
              money ? { label: m.label, value: m.monto, display: fmtMoney(m.monto), note: ventasN(m.value), color: "var(--st-critical)" } : { label: m.label, value: m.value, color: "var(--st-critical)" },
            )}
            total={money ? v.monto.rechazado : v.rechazadas}
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
            ...(money
              ? [
                  { key: "monto", label: "Monto", align: "right" as const, render: (r: (typeof v.porEjecutivo)[number]) => fmtMoney(r.monto), sort: (r: (typeof v.porEjecutivo)[number]) => r.monto },
                  { key: "montoAprobado", label: "Monto aprobado", align: "right" as const, render: (r: (typeof v.porEjecutivo)[number]) => fmtMoney(r.montoAprobado), sort: (r: (typeof v.porEjecutivo)[number]) => r.montoAprobado },
                ]
              : []),
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
                ...(money
                  ? [
                      { key: "monto", label: "Monto", align: "right" as const, render: (r: (typeof v.mensual)[number]) => fmtMoney(r.monto) },
                      { key: "montoAprobado", label: "Monto aprobado", align: "right" as const, render: (r: (typeof v.mensual)[number]) => fmtMoney(r.montoAprobado) },
                    ]
                  : []),
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
  const vs = vsLabel(prev, a);
  return (
    <Stack>
      <FigureStrip
        figures={[
          {
            label: "Clientes en la base",
            num: b.total,
            format: intOf,
            foot: b.porCarga.length > 1 ? "Únicos, sin repetir entre bases" : "Clientes únicos",
            delta: deltaOf(b.total, prev?.base?.total, vs, { upIsGood: null }),
            onOpen: () => open({ fuente: "base", title: "Clientes de la base" }),
          },
          // Las bases originales; las adicionales se resumen aparte.
          ...b.porCarga.filter((f) => !f.adicional).map((f) => ({
            label: label(f.dataset),
            num: f.unicos,
            format: intOf,
            foot: f.registros !== f.unicos ? `${fmtInt.format(f.registros)} filas en el archivo` : "Clientes únicos",
          })),
          ...(b.porCarga.some((x) => x.adicional)
            ? [
                {
                  label: "Bases adicionales",
                  num: b.porCarga.filter((x) => x.adicional).reduce((sum, x) => sum + x.nuevos, 0),
                  format: intOf,
                  foot: `Clientes nuevos en ${b.porCarga.filter((x) => x.adicional).length === 1 ? "1 base adicional" : `${b.porCarga.filter((x) => x.adicional).length} bases adicionales`}`,
                },
              ]
            : []),
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

      {b.porCarga.length > 1 && (
        <ChartCard
          title="Bases del mes"
          note="La original y las adicionales, en orden de llegada. Un cliente que viene en varias se cuenta en la primera que lo trajo; llamados, contacto y ventas son de sus clientes nuevos. Clic para ver los clientes de cada base."
        >
          <DataTable
            rows={b.porCarga}
            onRowClick={(r) => open({ fuente: "base", title: r.adicional ? r.nombre || "Base adicional" : label(r.dataset), filters: { carga: r.uploadId } })}
            rowHint="Ver los clientes de esta base"
            cols={[
              {
                key: "base",
                label: "Base",
                render: (r) => (
                  <span className="inline-flex items-center gap-2">
                    {r.adicional ? r.nombre || "Base adicional" : label(r.dataset)}
                    {r.adicional && <span className="rounded-full bg-[var(--viz-2)]/12 px-2 py-0.5 text-[11px] font-medium text-[var(--viz-2)]">Adicional</span>}
                  </span>
                ),
              },
              { key: "llegada", label: "Llegó", render: (r) => new Intl.DateTimeFormat("es-SV", { day: "numeric", month: "short" }).format(new Date(r.llegada)), sort: (r) => r.llegada },
              { key: "unicos", label: "Clientes", align: "right", render: (r) => fmtInt.format(r.unicos), sort: (r) => r.unicos },
              { key: "nuevos", label: "Nuevos", align: "right", render: (r) => fmtInt.format(r.nuevos), sort: (r) => r.nuevos },
              { key: "repetidos", label: "Repetidos", align: "right", render: (r) => fmtInt.format(r.repetidos), sort: (r) => r.repetidos },
              ...(a.llamadas
                ? [
                    {
                      key: "llamados",
                      label: "Llamados",
                      align: "right" as const,
                      render: (r: (typeof b.porCarga)[number]) => `${fmtInt.format(r.llamados)} (${fmtPct(share(r.llamados, r.nuevos), 0)})`,
                      sort: (r: (typeof b.porCarga)[number]) => share(r.llamados, r.nuevos),
                    },
                    {
                      key: "contactados",
                      label: "Con contacto",
                      align: "right" as const,
                      render: (r: (typeof b.porCarga)[number]) => `${fmtInt.format(r.contactados)} (${fmtPct(share(r.contactados, r.llamados), 0)})`,
                      sort: (r: (typeof b.porCarga)[number]) => share(r.contactados, r.llamados),
                    },
                  ]
                : []),
              ...(a.ventas
                ? [
                    { key: "ventas", label: "Ventas", align: "right" as const, render: (r: (typeof b.porCarga)[number]) => fmtInt.format(r.ventas), sort: (r: (typeof b.porCarga)[number]) => r.ventas },
                    {
                      key: "penetracion",
                      label: "Penetración",
                      align: "right" as const,
                      render: (r: (typeof b.porCarga)[number]) => <PctCell value={r.penetracion} max={Math.max(...b.porCarga.map((x) => x.penetracion), 0.0001)} digits={2} />,
                      sort: (r: (typeof b.porCarga)[number]) => r.penetracion,
                    },
                  ]
                : []),
            ]}
          />
        </ChartCard>
      )}

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
  const vs = vsLabel(prev, a);
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
  const vs = vsLabel(prev, a);
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
              ? `Para ver la meta individual de ${a.agente}, registra la meta del mes y el HC (agentes autorizados) con el filtro quitado.`
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
  const metaMTD = c.esperado ?? 0;
  const adelante = c.ventas >= metaMTD;
  // CDC y Extra se miden en dólares; las demás campañas, en número de ventas.
  const money = c.unidad === "monto";
  const val = (x: number | null) => (money ? fmtMoney(x) : fmtNum(x, 1));
  const valInt = (x: number | null) => (x === null ? "—" : money ? fmtMoney(x) : fmtInt.format(Math.round(x)));
  const unit = money ? "" : " ventas";
  const corte = c.fechaCorte ? dayLabel(c.fechaCorte) : null;
  // Mes en curso con una sábana que llega a varios días atrás: se avisa (el MTD ya se mide al corte).
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const stale = Boolean(a.month === currentMonth() && c.fechaCorte && (Date.parse(todayIso) - Date.parse(c.fechaCorte)) / 86_400_000 >= 3);
  const openCounted = () => open({ fuente: "ventas", title: "Ventas que cuentan para la meta", filters: { estatus: c.config.estatus } });
  const mtdTone = c.avanceMTD === null ? undefined : c.avanceMTD >= 100 ? ("good" as const) : c.avanceMTD >= 90 ? ("warn" as const) : ("bad" as const);
  type Row = (typeof c.porAgente)[number] & { ingresadas: number | null };
  // Lo que llevan ingresado los agentes: las ventas que capturaron en el CRM (si se cargó el archivo del CRM del mes).
  const crm = a.crm;
  const ingresadasDe = new Map((crm?.porAgente ?? []).map((x) => [x.label, x.value]));
  const parteMes = c.diasDelMes ? c.diaDelMes / c.diasDelMes : 0;
  const filas: Row[] = [
    ...c.porAgente.map((r) => ({ ...r, ingresadas: crm ? (ingresadasDe.get(r.agent) ?? 0) : null })),
    // Quien ingresó ventas pero todavía no tiene ninguna en la sábana del banco también aparece (con 0 que cuentan).
    ...(crm?.porAgente ?? [])
      .filter((x) => !c.porAgente.some((r) => r.agent === x.label) && (!a.agente || x.label === a.agente))
      .map((x) => {
        const metaMTD = c.metaPorAgente === null ? null : c.metaPorAgente * parteMes;
        return {
          agent: x.label,
          ventas: 0,
          total: 0,
          operaciones: 0,
          aprobadas: 0,
          meta: c.metaPorAgente,
          gap: c.metaPorAgente,
          avance: c.metaPorAgente ? 0 : null,
          metaMTD,
          gapMTD: metaMTD,
          avanceMTD: metaMTD ? 0 : null,
          ingresadas: x.value,
        };
      }),
  ];
  const enSabana = c.operacionesTotales;
  // Lo que cuenta, separado por mes de venta: el mes actual y la cosecha de meses anteriores.
  const origenParts = [
    { key: a.month, label: `Vendido en ${mes.split(" ")[0]}`, value: Math.max(0, c.ventas - c.cosecha.valor), color: "var(--viz-1)" },
    ...c.cosecha.porMes.map((m, i) => ({ key: m.month, label: `Cosecha de ${monthLabel(m.month).split(" ")[0]}`, value: m.valor, color: `var(--viz-${(i % 3) + 2})` })),
  ];
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
            label: a.agente ? `Cumplimiento MTD de ${a.agente}` : "Cumplimiento MTD",
            num: c.avanceMTD ?? 0,
            format: pct1,
            tone: mtdTone,
            foot: (
              <>
                {valInt(c.ventas)}
                {unit} de una meta MTD de {valInt(metaMTD)}
                {unit}, al día hábil {c.diaDelMes} de {c.diasDelMes}
                {money && <> ({fmtInt.format(c.operaciones)} operaciones)</>}
              </>
            ),
          },
          {
            label: a.agente ? "Ingresadas" : "Ingresadas por los agentes",
            ...(crm ? { num: crm.total, format: intOf } : { value: "—" }),
            foot: crm
              ? `En el CRM. ${fmtInt.format(enSabana)} en la sábana, ${fmtInt.format(c.operaciones)} cuentan${crm.total ? ` (${fmtPct(share(c.operaciones, crm.total), 0)})` : ""}`
              : `Falta el archivo de ventas del CRM. En la sábana: ${fmtInt.format(enSabana)}`,
            onOpen: crm ? () => open({ fuente: "crm", title: "Ventas ingresadas en el CRM" }) : undefined,
          },
          {
            label: "Avance del mes",
            num: c.avance ?? 0,
            format: pct1,
            tone: c.faltan === 0 ? "good" : undefined,
            foot: `${valInt(c.ventas)} de ${a.agente ? val(meta) : valInt(meta)}${unit}${!a.agente && c.agentes ? `, HC ${c.agentes} (${val(c.metaPorAgente)} c/u)` : ""}`,
          },
          {
            label: "Faltan para la meta",
            num: c.faltan ?? 0,
            format: money ? fmtMoney : num1,
            foot: c.faltan === 0 ? "Meta alcanzada" : c.ritmoNecesario !== null ? `${val(c.ritmoNecesario)} por día hábil en los ${c.diasRestantes} que quedan` : "Ya no quedan días hábiles",
            tone: c.faltan === 0 ? "good" : c.ritmoNecesario !== null && c.ritmoNecesario > c.ritmoDiario ? "warn" : undefined,
          },
          { label: "Ritmo actual", num: c.ritmoDiario, format: money ? fmtMoney : num1, foot: `${money ? "Dólares" : "Ventas"} por día hábil` },
          { label: "Proyección al cierre", num: c.proyeccion, format: money ? fmtMoney : intOf, foot: `${fmtPct(share(c.proyeccion, meta))} de la meta al ritmo actual`, tone: c.proyeccion >= meta ? "good" : "bad" },
        ]}
      >
        <Meter thick value={c.ventas} max={meta} mark={metaMTD} markLabel={`Meta MTD al ${corte ?? "corte"}: ${valInt(metaMTD)}${unit}`} label="Avance contra la meta del mes" />
        <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">
          {corte ? (
            <>
              Corte de la sábana: {corte}, día hábil {c.diaDelMes} de {c.diasDelMes}. La marca es la meta MTD: {valInt(metaMTD)}
              {unit}.{" "}
              <span className={adelante ? "text-[var(--st-good)]" : "text-[var(--st-critical)]"}>
                {adelante ? `Van ${valInt(c.ventas - metaMTD)} por encima.` : `Van ${valInt(metaMTD - c.ventas)} por debajo.`}
              </span>
            </>
          ) : (
            "La sábana del mes no trae fechas de venta."
          )}
        </p>
        {stale && (
          <p className="mt-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
            La sábana de {mes.split(" ")[0]} llega hasta el {corte}: puede venir incompleta o atrasada. El MTD se mide a esa fecha (día hábil {c.diaDelMes}), así que no
            cuenta como atraso lo que la sábana aún no trae. Al cargar la sábana actualizada se recalcula todo.
          </p>
        )}
        <p className="mt-1.5 text-[12.5px] text-ink-faint">
          {reglas}
          {c.agentes ? ` HC: ${c.agentes} agentes autorizados.` : ""}{" "}
          <button type="button" onClick={openCounted} className="font-medium text-brand-600 hover:underline">
            Ver las ventas que cuentan
          </button>
        </p>
      </FigureStrip>

      {(c.cosecha.operaciones > 0 || c.yaContadas.operaciones > 0) && (
        <ChartCard
          title="De dónde sale lo que cuenta"
          note={`Cosecha: lo vendido en meses anteriores que el banco ${money ? "aplicó o desembolsó" : "entregó o activó"} en ${mes} cuenta para la meta de ${mes}. Clic en una parte para ver sus ventas.`}
        >
          <ShareBar
            format={money ? fmtMoney : intOf}
            label="Lo que cuenta para la meta según el mes de venta"
            parts={origenParts}
            onSelect={(x) => {
              const m = origenParts.find((q) => q.label === x.label)?.key ?? a.month!;
              open({
                fuente: "ventas",
                title: m === a.month ? `Vendidas en ${mes.split(" ")[0]} que cuentan` : `Cosecha de ${monthLabel(m)}`,
                filters: { estatus: c.config.estatus, ...(m === a.month ? { desde: `${m}-01` } : { desde: `${m}-01`, hasta: `${m}-31` }) },
              });
            }}
          />
          {c.yaContadas.operaciones > 0 && (
            <p className="mt-5 text-[13px] text-ink-soft">
              {fmtInt.format(c.yaContadas.operaciones)} {c.yaContadas.operaciones === 1 ? "venta vuelve" : "ventas vuelven"} a aparecer en la sábana de {mes.split(" ")[0]} pero ya
              {c.yaContadas.operaciones === 1 ? " contó" : " contaron"} para la meta de un mes anterior: no se repite{c.yaContadas.operaciones === 1 ? "" : "n"}
              {money ? ` (${fmtMoney(c.yaContadas.valor)})` : ""}.
            </p>
          )}
        </ChartCard>
      )}

      <ChartCard
        title="Gap por agente"
        note={
          c.metaPorAgente === null
            ? "Registra el HC (agentes autorizados) para calcular la meta de cada agente"
            : `Meta del mes por agente: ${val(c.metaPorAgente)} (meta ÷ HC ${c.agentes}). La meta MTD es la parte que corresponde a ${c.diaDelMes} de ${c.diasDelMes} días hábiles. Clic en un agente para filtrar la campaña.`
        }
      >
        <DataTable
          rows={filas}
          initialSort="ventas"
          onRowClick={(r) => setAgent(a.agente === r.agent ? null : r.agent)}
          rowHint="Filtrar la campaña por este agente"
          isActive={(r) => r.agent === a.agente}
          cols={[
            { key: "agent", label: "Agente", render: (r) => r.agent, sort: (r) => r.agent },
            ...(crm ? [{ key: "ingresadas", label: "Ingresadas", align: "right" as const, render: (r: Row) => fmtInt.format(r.ingresadas ?? 0), sort: (r: Row) => r.ingresadas ?? 0 }] : []),
            { key: "total", label: money ? "Monto en sábana" : "En sábana", align: "right", render: (r) => valInt(r.total), sort: (r) => r.total },
            { key: "ventas", label: money ? "Monto que cuenta" : "Cuentan", align: "right", render: (r) => valInt(r.ventas), sort: (r) => r.ventas },
            ...(money ? [{ key: "operaciones", label: "Operaciones", align: "right" as const, render: (r: Row) => fmtInt.format(r.operaciones), sort: (r: Row) => r.operaciones }] : []),
            { key: "metaMTD", label: "Meta MTD", align: "right", render: (r) => val(r.metaMTD), sort: (r) => r.metaMTD ?? 0 },
            {
              key: "gapMTD",
              label: "Gap MTD",
              align: "right",
              render: (r) =>
                r.gapMTD === null ? "—" : <span className={r.gapMTD > 0 ? "text-[var(--st-critical)]" : "text-[var(--st-good)]"}>{r.gapMTD > 0 ? `−${val(r.gapMTD)}` : `+${val(-r.gapMTD)}`}</span>,
              sort: (r) => r.gapMTD ?? 0,
            },
            {
              key: "avanceMTD",
              label: "Cumplimiento MTD",
              align: "right",
              render: (r) =>
                r.avanceMTD === null ? (
                  "—"
                ) : (
                  <span className="inline-flex items-center justify-end gap-3">
                    <span className="hidden w-20 sm:block">
                      <Meter value={r.ventas} max={r.metaMTD ?? 0} />
                    </span>
                    <span className="w-12 tabular-nums">{fmtPct(r.avanceMTD, 0)}</span>
                  </span>
                ),
              sort: (r) => r.avanceMTD ?? 0,
            },
            { key: "meta", label: "Meta del mes", align: "right", render: (r) => val(r.meta) },
            { key: "avance", label: "Avance del mes", align: "right", render: (r) => (r.avance === null ? "—" : fmtPct(r.avance, 0)), sort: (r) => r.avance ?? 0 },
          ]}
        />
      </ChartCard>
    </Stack>
  );
}

/* ---------- Histórico ---------- */

interface Trend {
  key: string;
  title: string;
  value: (m: MonthSummary) => number | null;
  format: (n: number) => string;
  axis?: (n: number) => string;
  rate?: boolean;
  upIsGood?: boolean | null;
  note?: string;
}

function TrendCard({ t, meses, active, onSelect }: { t: Trend; meses: MonthSummary[]; active: string | null; onSelect: (m: string) => void }) {
  const rows = meses.filter((m) => t.value(m) !== null);
  // La cifra grande es la del mes que se eligió (o el último con dato) contra el mes anterior que tenga dato.
  const sel = meses.find((m) => m.month === active) ?? rows.at(-1);
  const value = sel ? t.value(sel) : null;
  const before = sel ? rows.filter((m) => m.month < sel.month).at(-1) : undefined;
  const delta = value !== null && before ? deltaOf(value, t.value(before), `vs ${monthLabel(before.month).split(" ")[0]}`, { rate: t.rate, upIsGood: t.upIsGood }) : undefined;
  return (
    <Panel className="p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] text-ink-soft">{t.title}</h3>
          <p className="mt-1.5 text-[30px] leading-tight font-normal tracking-[-0.02em] text-ink tabular-nums">{value !== null ? t.format(value) : "—"}</p>
          <p className="mt-1 text-[12.5px] text-ink-faint first-letter:uppercase">{sel ? `${monthLabel(sel.month)}${value === null ? " · sin este dato" : ""}` : "Sin datos"}</p>
        </div>
        {delta && <DeltaBadge d={delta} />}
      </div>
      {t.note && <p className="mt-2 text-[12.5px] text-ink-faint">{t.note}</p>}
      <div className="mt-5">
        {rows.length ? (
          <Columns
            height={190}
            active={active}
            format={t.format}
            axisFormat={t.axis}
            onSelect={(d) => onSelect(d.key)}
            selectHint="Clic para ver este mes"
            data={rows.map((m) => ({ key: m.month, label: monthShort(m.month), title: monthLabel(m.month), parts: [{ label: t.title, value: t.value(m)!, color: "var(--viz-1)" }] }))}
          />
        ) : (
          <p className="text-sm text-ink-soft">Ningún mes tiene este dato.</p>
        )}
      </div>
    </Panel>
  );
}

function HistoricoTab({ a, setMonth }: Ctx) {
  const h = useQuery(consultaHistorico(a.campaign, a.agente));
  const money = isCampaignCode(a.campaign) && GOAL_UNIT[a.campaign] === "monto";
  const [cut, setCut] = useState<"dia" | "mes">("dia");
  if (h.isPending) return <p className="text-sm text-ink-soft">Calculando el histórico…</p>;
  if (h.isError) return <ErrorMessage>{h.error.message}</ErrorMessage>;
  const meses = h.data;
  const pctAxis = (n: number) => `${fmtInt.format(n)}%`;
  // Mes en curso: para comparar parejo, las ventas de cada mes se cuentan del día 1 al mismo día.
  const live = meses.find((m) => m.month === currentMonth() && m.hasta);
  const corte = live ? Number(live.hasta!.slice(8, 10)) : null;
  const sameDay = corte !== null && cut === "dia";
  const atCut = (serie: number[], full: number | null) => (full === null ? null : sameDay ? (serie[Math.min(corte!, serie.length) - 1] ?? 0) : full);
  const ventasDe = (m: MonthSummary) => atCut(m.acumulado.ventas, m.ventas);
  const montoDe = (m: MonthSummary) => atCut(m.acumulado.monto, m.monto);
  const alDia = sameDay ? ` al día ${corte}` : "";
  const trends: Trend[] = [
    money
      ? { key: "monto", title: `Monto de ventas${alDia}`, value: montoDe, format: fmtMoney, axis: (n) => `$${fmtNum(n / 1000, 0)}k`, upIsGood: true, note: sameDay ? `Cada mes sumado del 1 al ${corte}` : undefined }
      : { key: "ventas", title: sameDay ? `Ventas al día ${corte}` : "Ventas de la sábana", value: ventasDe, format: intOf, upIsGood: true, note: sameDay ? `Cada mes contado del 1 al ${corte}` : undefined },
    { key: "aprobacion", title: "Aprobación", value: (m) => m.aprobacion, format: pct1, axis: pctAxis, rate: true, note: "Aprobadas sobre las ya resueltas por el banco" },
    {
      key: "cumplimiento",
      title: "Cumplimiento de la meta",
      value: (m) => m.cumplimiento,
      format: pct1,
      axis: pctAxis,
      rate: true,
      note:
        (live ? `Lo que cuenta para la meta sobre la meta del mes; ${monthLabel(live.month).split(" ")[0]} va a la fecha` : "Lo que cuenta para la meta sobre la meta del mes") +
        (meses.some((m) => m.oficial) ? ". Meses cerrados: meta y resultado de tu archivo de cumplimientos" : ""),
    },
    { key: "base", title: "Clientes en la base", value: (m) => m.base, format: intOf, upIsGood: null, note: "Original más bases adicionales, sin repetir" },
    { key: "contactabilidad", title: "Contactabilidad", value: (m) => m.contactabilidad, format: pct1, axis: pctAxis, rate: true },
    { key: "penetracion", title: "Penetración de la base", value: (m) => m.penetracion, format: pct2, axis: pctAxis, rate: true },
  ];
  type R = MonthSummary;
  const opt = <T,>(v: T | null, f: (x: T) => string) => (v === null ? "—" : f(v));
  return (
    <Stack>
      {live && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-hair bg-white px-5 py-4 dark:bg-slate-900">
          <p className="max-w-3xl text-[13.5px] leading-relaxed text-ink-soft">
            <span className="inline-block font-medium text-ink first-letter:uppercase">{monthLabel(live.month)}</span> va en curso, con datos hasta el {dayLabel(live.hasta!)}.{" "}
            {sameDay ? `Para comparar parejo, las ventas de cada mes se cuentan del 1 al ${corte}.` : "Las ventas de los meses anteriores están completas."}
          </p>
          <div className="flex items-center gap-1 rounded-full bg-hair/70 p-1 dark:bg-slate-800/70" role="group" aria-label="Cómo comparar las ventas">
            {(
              [
                ["dia", `Al día ${corte}`],
                ["mes", "Mes completo"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setCut(v)}
                aria-pressed={cut === v}
                className={`rounded-full px-3.5 py-1 text-[13px] whitespace-nowrap transition-colors ${cut === v ? "bg-white font-medium text-ink shadow-[0_1px_2px_rgba(14,27,61,0.08)] dark:bg-slate-700" : "text-ink-soft hover:text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {meses.length < 2 && (
        <Aside>
          Por ahora hay {meses.length === 1 ? "un solo mes" : "ningún mes"} con archivos. Al cargar otros meses (sábana, base y tipificaciones de cada mes) aquí se comparan mes contra mes.
        </Aside>
      )}
      <div className="grid gap-8 lg:grid-cols-2 2xl:grid-cols-3">
        {trends.map((t) => (
          <TrendCard key={t.key} t={t} meses={meses} active={a.month} onSelect={setMonth} />
        ))}
      </div>

      <ChartCard title="Mes a mes" note={a.agente ? `Solo ${a.agente}. La base es la misma para todos los agentes.` : "Cada mes con sus archivos vigentes. Clic en un mes para verlo en las demás pestañas."}>
        <DataTable
          rows={[...meses].reverse()}
          onRowClick={(r) => setMonth(r.month)}
          rowHint="Ver este mes"
          isActive={(r) => r.month === a.month}
          maxRows={24}
          cols={[
            {
              key: "month",
              label: "Mes",
              render: (r) => (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block first-letter:uppercase">{monthLabel(r.month)}</span>
                  {r === live && <span className="rounded-full bg-[var(--st-good)]/12 px-2 py-0.5 text-[11px] font-medium text-[var(--st-good)]">en curso</span>}
                </span>
              ),
              sort: (r) => r.month,
            },
            { key: "ventas", label: sameDay ? `Ventas al día ${corte}` : "Ventas", align: "right", render: (r) => opt(ventasDe(r), (x) => fmtInt.format(x)), sort: (r) => ventasDe(r) ?? -1 },
            { key: "aprobadas", label: "Aprobadas", align: "right", render: (r) => opt(r.aprobadas, (x) => fmtInt.format(x)), sort: (r) => r.aprobadas ?? -1 },
            { key: "aprobacion", label: "Aprobación", align: "right", render: (r) => opt(r.aprobacion, (x) => fmtPct(x)), sort: (r) => r.aprobacion ?? -1 },
            ...(money
              ? [
                  { key: "monto", label: sameDay ? `Monto al día ${corte}` : "Monto", align: "right" as const, render: (r: R) => opt(montoDe(r), fmtMoney), sort: (r: R) => montoDe(r) ?? -1 },
                  { key: "montoAprobado", label: "Monto aprobado", align: "right" as const, render: (r: R) => opt(r.montoAprobado, fmtMoney), sort: (r: R) => r.montoAprobado ?? -1 },
                ]
              : []),
            {
              key: "base",
              label: "Base",
              align: "right",
              render: (r) => (r.base === null ? "—" : `${fmtInt.format(r.base)}${r.adicionales ? ` (+${r.adicionales} adic.)` : ""}`),
              sort: (r) => r.base ?? -1,
            },
            { key: "llamadas", label: "Llamadas", align: "right", render: (r) => opt(r.llamadas, (x) => fmtInt.format(x)), sort: (r) => r.llamadas ?? -1 },
            { key: "contactabilidad", label: "Contactabilidad", align: "right", render: (r) => opt(r.contactabilidad, (x) => fmtPct(x)), sort: (r) => r.contactabilidad ?? -1 },
            { key: "penetracion", label: "Penetración", align: "right", render: (r) => opt(r.penetracion, (x) => fmtPct(x, 2)), sort: (r) => r.penetracion ?? -1 },
            { key: "meta", label: "Meta", align: "right", render: (r) => opt(r.meta, (x) => (r.unidad === "monto" ? fmtMoney(x) : fmtInt.format(x))), sort: (r) => r.meta ?? -1 },
            {
              key: "logrado",
              label: "Logrado",
              align: "right",
              render: (r) => (
                <span title={r.oficial ? "Resultado oficial (archivo de cumplimientos)" : undefined}>
                  {opt(r.logrado, (x) => (r.unidad === "monto" ? fmtMoney(x) : fmtInt.format(x)))}
                  {r.oficial && <span className="ml-1 text-[11px] text-ink-faint">oficial</span>}
                </span>
              ),
              sort: (r) => r.logrado ?? -1,
            },
            ...(meses.some((m) => m.oficial)
              ? [
                  {
                    key: "logradoSabana",
                    label: "Según la sábana",
                    align: "right" as const,
                    render: (r: R) => (r.oficial ? opt(r.logradoSabana ?? null, (x) => (r.unidad === "monto" ? fmtMoney(x) : fmtInt.format(x))) : ""),
                    sort: (r: R) => r.logradoSabana ?? -1,
                  },
                ]
              : []),
            { key: "cumplimiento", label: "Cumplimiento", align: "right", render: (r) => (r.cumplimiento === null ? "—" : <PctCell value={r.cumplimiento} max={Math.max(100, ...meses.map((m) => m.cumplimiento ?? 0))} />), sort: (r) => r.cumplimiento ?? -1 },
          ]}
        />
      </ChartCard>
    </Stack>
  );
}

/* ---------- qué mes se está viendo ---------- */

/** "Estás viendo octubre 2026, mes en curso · datos hasta el mié 21 oct". */
function MonthStatus({ a }: { a: CampaignAnalysis }) {
  if (!a.month) return null;
  const today = currentMonth();
  const state = a.month === today ? "mes en curso" : a.month < today ? "mes cerrado" : "mes que aún no empieza";
  return (
    <p className="flex items-start gap-2 text-[13px] text-ink-soft">
      <span className={`mt-[7px] size-2 shrink-0 rounded-full ${a.month === today ? "bg-[var(--st-good)]" : "bg-ink-faint/50"}`} aria-hidden />
      <span>
        Estás viendo <span className="font-medium text-ink">{monthLabel(a.month)}</span>, {state}
        {a.fechas.hasta && <> · datos hasta el {dayLabel(a.fechas.hasta)}</>}
      </span>
    </p>
  );
}

const KIND_LABEL = { sabana: "La sábana", tipif: "Las tipificaciones", ventas: "Las ventas del CRM" } as const;

/** Aviso si algún archivo vigente del mes trae filas con fecha de otro mes (se están contando en este). */
function OtherMonthsWarning({ a, code }: { a: CampaignAnalysis; code: string }) {
  const month = a.month;
  if (!month || !a.fechas.fuera.length) return null;
  return (
    <div role="status" className="mb-8 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[13.5px] leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
      <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        <p className="font-medium">Hay filas de otros meses dentro de {monthLabel(month)}</p>
        {a.fechas.fuera.map((f) => (
          <p key={f.kind}>
            {KIND_LABEL[f.kind]} trae {fmtInt.format(f.filas)} {f.filas === 1 ? "fila" : "filas"} con fecha de {joinY(f.meses.map(monthLabel))}; hoy se cuentan en {monthLabel(month)}.
          </p>
        ))}
        <p>
          Para separarlas, vuelve a cargar ese archivo en el{" "}
          <Link to={`/carga?campana=${code}`} className="font-medium underline underline-offset-2">
            Centro de carga
          </Link>
          : ahora guarda solo las filas del mes que elijas.
        </p>
      </div>
    </div>
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
    ...consultaAnalisis(code, requested, agent),
    enabled: valid,
    // Al cambiar de mes o de agente se queda lo anterior en pantalla hasta que llega lo nuevo
    // (pero nunca las cifras de otra campaña).
    placeholderData: (anterior, consulta) => (consulta?.queryKey[1] === code ? keepPreviousData(anterior) : undefined),
  });
  const a = analysis.data;
  const prevMonth = mesAnterior(a);
  const prev = useQuery({
    ...consultaAnalisis(code, prevMonth ?? null, agent),
    enabled: valid && Boolean(prevMonth),
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
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <AgentPicker agents={a.agentes} merged={a.agentesUnidos} value={agent} onChange={(x) => setQuery({ agente: x })} />
            <MonthStatus a={a} />
          </div>
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

      {a && <OtherMonthsWarning a={a} code={code} />}
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
          {current.slug === "historico" && <HistoricoTab {...ctx} />}
          {current.slug === "cumplimiento" && (
            <CumplimientoTab {...ctx} canEdit={me.data?.permissions.includes("config:editar") ?? false} refresh={() => void qc.invalidateQueries({ queryKey: ["analysis", code] })} />
          )}
        </div>
      )}

      {detail && a?.month && <ClientDetail campaign={code} month={a.month} agent={agent} spec={detail} onClose={closeDetail} />}
    </>
  );
}
