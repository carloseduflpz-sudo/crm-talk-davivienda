/* Vista de una campaña: 5 pestañas sobre los archivos VIGENTES del mes, que se exploran:
   - filtro por agente (toda la vista se recalcula para esa persona),
   - clic en cualquier cifra, barra o día para ver los clientes que la forman,
   - comparación contra el mes anterior en indicadores y curvas,
   - mes y agente en el enlace, para compartir exactamente lo que se ve. */
import { GOAL_UNIT, getCampaign, isCampaignCode, type CampaignAnalysis, type CampaignCode, type MonthSummary, type ProcesoRow, type SaleClass } from "@crm/core";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { BarChart3, Columns2, Database, History, PhoneCall, Target, TrendingUp, TriangleAlert, Upload, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
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
import { Desglose, type DesgloseSpec } from "../components/Desglose";
import { GoalForm, joinY, workDaysText } from "../components/GoalForm";
import { Button, ErrorMessage } from "../components/form";
import { EmptyState, PageHeader } from "../components/ui";
import { api } from "../lib/api";
import { consultaAnalisis, consultaHistorico, mesAnterior, type Dias } from "../lib/consultas";
import { downloadWorkbook } from "../lib/export";
import { currentMonth, monthLabel } from "../lib/xlsx";

export const CAMPAIGN_TABS = [
  { slug: "ventas", label: "Ventas", icon: TrendingUp, needs: "sabana", about: "Estatus del banco, rechazo por motivo, ejecutivos y comparativo mensual." },
  { slug: "base", label: "Base", icon: Database, needs: "base", about: "Clientes de la base, perfiles y penetración contra la sábana." },
  { slug: "efectividad", label: "Efectividad", icon: BarChart3, needs: "tipif", about: "Contactabilidad, registros y penetración, general y por agente." },
  { slug: "llamadas", label: "Llamadas", icon: PhoneCall, needs: "tipif", about: "Tipificaciones, intentos por cliente y ventas capturadas en el CRM." },
  { slug: "cumplimiento", label: "Cumplimiento", icon: Target, needs: "sabana", about: "Meta, avance, ritmo, proyección y gap por agente." },
  { slug: "historico", label: "Histórico", icon: History, needs: "sabana", about: "Comparativo mes a mes: ventas, base, contactabilidad, penetración y cumplimiento." },
  { slug: "comparativo", label: "Comparativo", icon: Columns2, needs: "sabana", about: "Un mes a la par del otro, con los mismos días: cómo íbamos contra cómo vamos." },
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
const fmtDec1 = new Intl.NumberFormat("es-SV", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const dec1 = (n: number) => fmtDec1.format(n);
const num1 = (n: number) => fmtNum(n);
/** Etiquetas del banco EN MAYÚSCULAS, en minúsculas para usarlas dentro de una frase. */
const lower = (s: string) => (s === s.toUpperCase() ? s.toLowerCase() : s.charAt(0).toLowerCase() + s.slice(1));
/** "vs agosto". */
/** "vs septiembre"; si el mes que se ve va en curso, se aclara que el anterior está completo. */
const vsLabel = (prev: CampaignAnalysis | undefined, a: CampaignAnalysis) =>
  !prev?.month
    ? ""
    : prev.dias
      ? `vs ${monthLabel(prev.month).split(" ")[0]} (${prev.dias.desde === prev.dias.hasta ? `día ${prev.dias.desde}` : `${prev.dias.desde} al ${prev.dias.hasta}`})`
      : `vs ${monthLabel(prev.month).split(" ")[0]}${a.month === currentMonth() && !a.dias ? " completo" : ""}`;

/** Lo que cada pestaña necesita para ser interactiva. */
interface Ctx {
  a: CampaignAnalysis;
  /** Análisis del mes anterior (mismo agente), para comparar. */
  prev?: CampaignAnalysis;
  open: (spec: DetailSpec) => void;
  setAgent: (agent: string | null) => void;
  setMonth: (month: string) => void;
  /** Rango de días del mes (null = el mes completo). */
  setDias: (d: Dias) => void;
  /** Cuántas hay en cada etapa y estatus (del mes, cosecha y total) detrás de una cifra de ventas. */
  desglosar: (titulo: string, clases: SaleClass[] | null, mes?: string) => void;
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

function VentasTab({ a, prev, open, setAgent, setMonth, desglosar }: Ctx) {
  const v = a.ventas;
  if (!v) return <Missing campaign={a.campaign} what="la sábana" month={a.month} icon={TrendingUp} />;
  const p = prev?.ventas;
  const vs = vsLabel(prev, a);
  // Mes en curso: el total y las aprobadas se comparan contra el mes anterior al mismo día.
  // (Con un rango de días elegido, el mes anterior ya viene con esos mismos días.)
  const corte = !a.dias && a.month === currentMonth() && a.fechas.hasta ? dayNum(a.fechas.hasta) : null;
  // Por día solo cuentan las fechas del mes; las ventas de meses anteriores (cosecha) van aparte.
  const days = v.porDia.filter((d) => d.date.startsWith(a.month!));
  const pDays = p && corte && prev?.month ? p.porDia.filter((d) => d.date.startsWith(prev.month!) && dayNum(d.date) <= corte) : null;
  const pSum = (k: "ventas" | "aprobadas" | "monto" | "montoAprobado") => (pDays ? pDays.reduce((t, d) => t + d[k], 0) : undefined);
  const cSum = (k: "ventas" | "aprobadas" | "monto" | "montoAprobado") => days.reduce((t, d) => t + d[k], 0);
  const vsDay = pDays && prev?.month ? `vendidas en el mes vs ${monthLabel(prev.month).split(" ")[0]} al día ${corte}` : vs;
  const cosechaTxt = v.cosecha.total ? `${fmtInt.format(v.cosecha.total)} de meses anteriores (cosecha)` : "";
  // CDC y Extra: los indicadores van en dólares (con la cantidad de ventas como referencia).
  const money = isCampaignCode(a.campaign) && GOAL_UNIT[a.campaign] === "monto";
  // Evaluadas (ya resueltas: en TC, ya pasaron por PCBM) → aprobadas → rechazadas → pendientes → % sobre las evaluadas.
  const ev = evaluacionDe(a.campaign);
  const parts = (["aprobado", "en_proceso", "rechazado"] as const).map((k) => ({
    key: k,
    label: k === "en_proceso" ? "Pendientes" : SALE_LABEL[k]!,
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
  // Cifra del comparativo mensual: clic abre su desglose (sin cambiar de mes; clic en el resto de la fila sí cambia).
  const cifraMes = (n: number, mes: string, titulo: string, clases: SaleClass[] | null) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        desglosar(titulo, clases, mes);
      }}
      title="Ver el desglose por etapa y estatus"
      className="tabular-nums underline decoration-hair decoration-dotted underline-offset-4 hover:text-brand-600 hover:decoration-brand-600"
    >
      {fmtInt.format(n)}
    </button>
  );
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
                onOpen: () => desglosar("Ventas del mes", null), openLabel: "Ver desglose",
              },
          // Todas las campañas: evaluadas → aprobadas → rechazadas → pendientes → % sobre las evaluadas, con sus estatus.
          {
            label: "Evaluadas",
            num: v.aprobadas + v.rechazadas,
            format: intOf,
            foot: `${ev.evaluadas} (${fmtPct(share(v.aprobadas + v.rechazadas, v.total))} de las ventas)`,
            delta: deltaOf(v.aprobadas + v.rechazadas, p ? p.aprobadas + p.rechazadas : undefined, vs),
            onOpen: () => desglosar(`${ev.cosa} evaluadas`, ["aprobado", "rechazado"]), openLabel: "Ver desglose",
          },
          {
            label: "Aprobadas",
            num: v.aprobadas,
            format: intOf,
            foot: `${fmtPct(share(v.aprobadas, v.aprobadas + v.rechazadas))} de las evaluadas${money ? ` · ${fmtMoney(v.monto.aprobado)}` : ""}`,
            delta: pDays ? deltaOf(cSum("aprobadas"), pSum("aprobadas"), vsDay) : deltaOf(v.aprobadas, p?.aprobadas, vs),
            onOpen: () => desglosar(`${ev.cosa} aprobadas`, ["aprobado"]), openLabel: "Ver desglose",
          },
          {
            label: "Rechazadas",
            num: v.rechazadas,
            format: intOf,
            foot: `${fmtPct(share(v.rechazadas, v.aprobadas + v.rechazadas))} de las evaluadas${money ? ` · ${fmtMoney(v.monto.rechazado)}` : ""}`,
            delta: deltaOf(v.rechazadas, p?.rechazadas, vs, { upIsGood: false }),
            onOpen: () => desglosar(`${ev.cosa} rechazadas`, ["rechazado"]), openLabel: "Ver desglose",
          },
          {
            label: "Pendientes",
            num: v.enProceso,
            format: intOf,
            foot: `${ev.pendientes} (${fmtPct(share(v.enProceso, v.total))} de las ventas)${money ? ` · ${fmtMoney(v.monto.enProceso)}` : ""}`,
            delta: deltaOf(v.enProceso, p?.enProceso, vs, { upIsGood: null }),
            onOpen: () => desglosar(`${ev.cosa} pendientes`, ["en_proceso"]), openLabel: "Ver desglose",
          },
          {
            label: "% Aprobación",
            num: v.aprobacion,
            format: pct1,
            foot: `${fmtInt.format(v.aprobadas)} ÷ ${fmtInt.format(v.aprobadas + v.rechazadas)} evaluadas`,
            delta: deltaOf(v.aprobacion, p?.aprobacion, vs, { rate: true }),
          },
          {
            label: "% Rechazo",
            num: share(v.rechazadas, v.aprobadas + v.rechazadas),
            format: pct1,
            foot: `${fmtInt.format(v.rechazadas)} ÷ ${fmtInt.format(v.aprobadas + v.rechazadas)} evaluadas`,
            delta: deltaOf(share(v.rechazadas, v.aprobadas + v.rechazadas), p ? share(p.rechazadas, p.aprobadas + p.rechazadas) : undefined, vs, { rate: true, upIsGood: false }),
          },
        ]}
      >
        <ShareBar
          parts={parts}
          format={money ? fmtMoney : intOf}
          label={money ? "Composición del monto por estatus del banco" : "Composición de las ventas por estatus del banco"}
          onSelect={(x) => open({ fuente: "ventas", title: `Ventas ${x.label.toLowerCase()}`, filters: { clase: parts.find((q) => q.label === x.label)!.key } })}
        />
      </FigureStrip>

      {v.pcbm && a.campaign === "tdc" && <EvaluacionPcbm p={v.pcbm} prev={prev?.ventas?.pcbm ?? null} prevMonth={prev?.month ?? null} open={open} desglosar={desglosar} />}

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

      {v.procesos.actual.length > 0 && (
        <TablaProcesos
          titulo="Proceso de las ventas del mes"
          nota={`Ventas con fecha de ${monthLabel(a.month!)} (o sin fecha), según el proceso en que va cada una en la sábana. La última fila suma también la cosecha (lo vendido en meses anteriores que trae esta sábana).`}
          filas={v.procesos.actual}
          cosecha={v.procesos.cosecha}
          money={money}
          open={open}
        />
      )}
      {v.procesos.cosecha.length > 0 && (
        <TablaProcesos titulo="Proceso de la cosecha" nota="Ventas de meses anteriores que trae la sábana de este mes, según el proceso en que va cada una." filas={v.procesos.cosecha} money={money} open={open} />
      )}
      {v.requisitos && <PendientesRequisito r={v.requisitos} campana={a.campaign} mes={a.month!} />}

      {v.porProceso.length > 1 && !v.procesos.actual.length && !v.procesos.cosecha.length && (
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
                { label: "Pendientes", value: m.enProceso, color: SALE_COLORS.en_proceso! },
                { label: "Rechazadas", value: m.rechazadas, color: SALE_COLORS.rechazado! },
              ],
              extra: [
                { label: "evaluadas", value: fmtInt.format(m.aprobadas + m.rechazadas) },
                { label: "aprobación", value: fmtPct(m.aprobacion) },
                { label: "rechazo", value: fmtPct(share(m.rechazadas, m.aprobadas + m.rechazadas)) },
              ],
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
                // Igual que arriba: ventas → evaluadas → aprobadas → rechazadas → pendientes → % sobre evaluadas.
                // Clic en una cifra: su desglose por etapa y estatus (del mes, cosecha y total) de ese mes.
                { key: "ventas", label: "Ventas", align: "right", render: (r) => cifraMes(r.ventas, r.month, "Ventas", null) },
                { key: "evaluadas", label: "Evaluadas", align: "right", render: (r) => cifraMes(r.aprobadas + r.rechazadas, r.month, `${ev.cosa} evaluadas`, ["aprobado", "rechazado"]) },
                { key: "aprobadas", label: "Aprobadas", align: "right", render: (r) => cifraMes(r.aprobadas, r.month, `${ev.cosa} aprobadas`, ["aprobado"]) },
                { key: "rechazadas", label: "Rechazadas", align: "right", render: (r) => cifraMes(r.rechazadas, r.month, `${ev.cosa} rechazadas`, ["rechazado"]) },
                { key: "enProceso", label: "Pendientes", align: "right", render: (r) => cifraMes(r.enProceso, r.month, `${ev.cosa} pendientes`, ["en_proceso"]) },
                ...(money
                  ? [
                      { key: "monto", label: "Monto", align: "right" as const, render: (r: (typeof v.mensual)[number]) => fmtMoney(r.monto) },
                      { key: "montoAprobado", label: "Monto aprobado", align: "right" as const, render: (r: (typeof v.mensual)[number]) => fmtMoney(r.montoAprobado) },
                    ]
                  : []),
                { key: "aprobacion", label: "% Aprobación", align: "right", render: (r) => fmtPct(r.aprobacion) },
                // % de rechazo sobre las evaluadas (aprobadas + rechazadas), igual que la aprobación.
                { key: "rechazo", label: "% Rechazo", align: "right", render: (r) => fmtPct(share(r.rechazadas, r.aprobadas + r.rechazadas)) },
              ]}
            />
          </div>
        </ChartCard>
      )}
    </Stack>
  );
}

/**
 * Evaluación PCBM (TDC): evaluadas = ya pasaron por PCBM (aprobadas + rechazadas); los % de aprobación y de rechazo
 * se sacan sobre las evaluadas. Del mes, de la cosecha y total; y la tabla por etapa como la dinámica de la sábana.
 */
function EvaluacionPcbm({
  p,
  prev,
  prevMonth,
  open,
  desglosar,
}: {
  p: NonNullable<NonNullable<CampaignAnalysis["ventas"]>["pcbm"]>;
  prev: NonNullable<NonNullable<CampaignAnalysis["ventas"]>["pcbm"]> | null;
  prevMonth: string | null;
  open: Ctx["open"];
  desglosar: Ctx["desglosar"];
}) {
  const filas = [
    { nombre: "Vendidas en el mes", f: p.mes, origen: "mes" as const },
    { nombre: "Cosecha (meses anteriores)", f: p.cosecha, origen: "cosecha" as const },
    { nombre: "Total de la sábana", f: p.total, origen: null, total: true },
  ].filter((x) => x.total || x.f.ventas > 0);
  // Clic en una cifra: las ventas (TC) detrás de ella.
  const CLASES = { ventas: [], evaluadas: ["aprobado", "rechazado"], aprobadas: ["aprobado"], rechazadas: ["rechazado"], pendientes: ["en_proceso"] } as const;
  const NOMBRE = { ventas: "Ventas", evaluadas: "TC evaluadas por PCBM", aprobadas: "TC aprobadas", rechazadas: "TC rechazadas", pendientes: "TC pendientes de evaluar" } as const;
  // Clic en una cifra: cuántas hay en cada etapa y subetapa (del mes, cosecha y total).
  const ver = (que: keyof typeof CLASES, _origen?: "mes" | "cosecha" | null) => desglosar(NOMBRE[que], CLASES[que].length ? [...CLASES[que]] : null);
  const cifra = (n: number, onClick: () => void, fuerte = false) =>
    n > 0 ? (
      <button type="button" onClick={onClick} title="Ver cuáles son" className={`tabular-nums underline decoration-hair decoration-dotted underline-offset-4 hover:text-brand-600 hover:decoration-brand-600 ${fuerte ? "font-semibold text-ink" : ""}`}>
        {fmtInt.format(n)}
      </button>
    ) : (
      <span className={fuerte ? "font-semibold text-ink" : ""}>0</span>
    );
  const pm = prevMonth ? monthLabel(prevMonth).split(" ")[0] : "";
  type F = (typeof filas)[number];
  const b = (x: { total?: boolean }, v: ReactNode) => (x.total ? <span className="font-semibold text-ink">{v}</span> : v);
  type E = (typeof p.etapas)[number] & { total?: boolean; primera?: boolean };
  const etapas: E[] = [
    ...p.etapas.map((e, i) => ({ ...e, primera: i === 0 || p.etapas[i - 1]!.etapa !== e.etapa })),
    { etapa: "Total general", estatus: "", clase: "en_proceso" as const, ventas: p.total.ventas, cosecha: p.total.ventas - p.mes.ventas, total: true },
  ];
  return (
    <ChartCard title="Evaluación PCBM" note="Evaluadas: ventas que ya pasaron por PCBM, aprobadas (entregada, en distribución, sin embozo, devolución…) o rechazadas. Los % de aprobación y de rechazo se sacan sobre las evaluadas. Pendientes: las que siguen en PCBM o en apoyo Talk. Clic en cualquier cifra o fila para ver cuáles TC son.">
      <div className="mb-6 grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        {[
          { label: "Evaluadas por PCBM", v: fmtInt.format(p.total.evaluadas), foot: `de ${fmtInt.format(p.total.ventas)} ventas`, que: "evaluadas" as const },
          { label: "% Aprobación", v: fmtPct(p.total.aprobacion), foot: `${fmtInt.format(p.total.aprobadas)} aprobadas${prev && prev.total.evaluadas ? ` · ${pm}: ${fmtPct(prev.total.aprobacion)}` : ""}`, que: "aprobadas" as const },
          { label: "% Rechazo", v: fmtPct(p.total.rechazo), foot: `${fmtInt.format(p.total.rechazadas)} rechazadas${prev && prev.total.evaluadas ? ` · ${pm}: ${fmtPct(prev.total.rechazo)}` : ""}`, que: "rechazadas" as const },
          { label: "Pendientes", v: fmtInt.format(p.total.pendientes), foot: "aún sin evaluar", que: "pendientes" as const },
        ].map((k) => (
          <button
            key={k.label}
            type="button"
            onClick={() => ver(k.que, null)}
            title="Ver cuáles son"
            className="-m-2 rounded-xl p-2 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/50"
          >
            <p className="text-[13px] text-ink-soft">{k.label}</p>
            <p className="mt-1 text-[26px] font-semibold tabular-nums text-ink">{k.v}</p>
            <p className="text-[12px] text-ink-soft">{k.foot}</p>
          </button>
        ))}
      </div>
      <DataTable
        rows={filas}
        cols={[
          { key: "nombre", label: "", render: (x: F) => b(x, x.nombre) },
          { key: "ventas", label: "Ventas", align: "right", render: (x: F) => cifra(x.f.ventas, () => ver("ventas", x.origen), x.total) },
          { key: "evaluadas", label: "Evaluadas", align: "right", render: (x: F) => cifra(x.f.evaluadas, () => ver("evaluadas", x.origen), x.total) },
          { key: "aprobadas", label: "Aprobadas", align: "right", render: (x: F) => cifra(x.f.aprobadas, () => ver("aprobadas", x.origen), x.total) },
          { key: "rechazadas", label: "Rechazadas", align: "right", render: (x: F) => cifra(x.f.rechazadas, () => ver("rechazadas", x.origen), x.total) },
          { key: "aprobacion", label: "% Aprobación", align: "right", render: (x: F) => b(x, x.f.evaluadas ? fmtPct(x.f.aprobacion) : "—") },
          { key: "rechazo", label: "% Rechazo", align: "right", render: (x: F) => b(x, x.f.evaluadas ? fmtPct(x.f.rechazo) : "—") },
          { key: "pendientes", label: "Pendientes", align: "right", render: (x: F) => cifra(x.f.pendientes, () => ver("pendientes", x.origen), x.total) },
        ]}
      />
      <h3 className="mt-8 mb-2 text-[14px] font-semibold text-ink">Por etapa (como la tabla dinámica de la sábana)</h3>
      <DataTable
        rows={etapas}
        onRowClick={(e) =>
          open(
            e.total
              ? { fuente: "ventas", title: "Todas las ventas de la sábana" }
              : { fuente: "ventas", title: `${e.etapa} · ${e.estatus}`, filters: { etapa: e.etapa, estatus: e.estatus } },
          )
        }
        rowHint="Ver cuáles son"
        cols={[
          { key: "etapa", label: "Etapa primaria", render: (e: E) => b(e, e.total || e.primera ? e.etapa : "") },
          { key: "estatus", label: "Subetapa", render: (e: E) => e.estatus },
          { key: "ventas", label: "Total", align: "right", render: (e: E) => b(e, fmtInt.format(e.ventas)) },
          { key: "pct", label: "%", align: "right", render: (e: E) => b(e, fmtPct(share(e.ventas, p.total.ventas), 0)) },
          { key: "cosecha", label: "De ellas, cosecha", align: "right", render: (e: E) => b(e, e.cosecha ? fmtInt.format(e.cosecha) : "—") },
        ]}
      />
      <p className="mt-3 text-[13px] text-ink-soft">
        Cuadre: {fmtInt.format(p.total.aprobadas)} aprobadas + {fmtInt.format(p.total.rechazadas)} rechazadas = {fmtInt.format(p.total.evaluadas)} evaluadas; + {fmtInt.format(p.total.pendientes)} pendientes ={" "}
        {fmtInt.format(p.total.ventas)} ventas.
      </p>
    </ChartCard>
  );
}

/** Pendientes por requisito: qué documento se le está pidiendo a cada cliente, con la lista para descargar. */
function PendientesRequisito({ r, campana, mes }: { r: NonNullable<NonNullable<CampaignAnalysis["ventas"]>["requisitos"]>; campana: string; mes: string }) {
  // La lista de clientes va aparte (panel lateral); aquí solo las cantidades.
  const [lista, setLista] = useState<{ titulo: string; filtro: (c: (typeof r.clientes)[number]) => boolean } | null>(null);
  // Días pendiente: desde la primera sábana en que ya venía pendiente por requisito hasta hoy.
  const hoy = new Date();
  const hoyUTC = Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const dias = (iso: string | null) => (iso ? Math.max(0, Math.round((hoyUTC - Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)))) / 86_400_000)) : null);
  const total = r.clientes.length;
  const cosecha = r.clientes.filter((c) => c.origen === "cosecha").length;
  const conDias = r.clientes.map((c) => dias(c.pendienteDesde)).filter((d): d is number => d !== null);
  const promedio = conDias.length ? conDias.reduce((t, d) => t + d, 0) / conDias.length : null;
  const TRAMOS = [
    { label: "0 a 7 días", de: 0, a: 7 },
    { label: "8 a 15 días", de: 8, a: 15 },
    { label: "16 a 30 días", de: 16, a: 30 },
    { label: "Más de 30 días", de: 31, a: Infinity },
  ];
  const enTramo = (t: (typeof TRAMOS)[number]) => (c: (typeof r.clientes)[number]) => {
    const d = dias(c.pendienteDesde);
    return d !== null && d >= t.de && d <= t.a;
  };
  const mas15 = r.clientes.filter((c) => (dias(c.pendienteDesde) ?? 0) > 15).length;

  const columnas = [
    { key: "niu", label: "NIU" },
    { key: "nombre", label: "Cliente" },
    { key: "agente", label: "Ejecutivo" },
    { key: "fecha", label: "Fecha de venta" },
    { key: "estatus", label: "Estatus" },
    { key: "pendienteDesde", label: "Pendiente desde" },
    { key: "dias", label: "Días pendiente" },
    { key: "diasBanco", label: "Días en proceso (banco)" },
    { key: "grupo", label: "Documentos (unificado)" },
    { key: "documento", label: "Documento pedido (como viene)" },
    { key: "documentacion", label: "Documentación" },
    { key: "observacion", label: "Observación" },
    { key: "origen", label: "Venta" },
  ];
  const descargar = (filas: typeof r.clientes) =>
    void downloadWorkbook(`Pendientes por requisito ${campana.toUpperCase()} ${mes}.xlsx`, [
      { name: "Pendientes", columns: columnas, rows: filas.map((c) => ({ ...c, dias: dias(c.pendienteDesde), origen: c.origen === "mes" ? "Del mes" : "Cosecha" })) },
      {
        name: "Por documento",
        columns: [
          { key: "label", label: "Documentos" },
          { key: "clientes", label: "Ventas pendientes" },
        ],
        rows: [...r.porDocumento, { label: "Total", clientes: total }],
      },
    ]);
  const kpis = [
    { label: "Pendientes por requisito", v: fmtInt.format(total), foot: `${fmtInt.format(total - cosecha)} del mes · ${fmtInt.format(cosecha)} de cosecha` },
    { label: "Promedio de días pendiente", v: promedio === null ? "—" : fmtNum(promedio, 1), foot: "desde la primera sábana en que venía pendiente" },
    { label: "Más de 15 días", v: fmtInt.format(mas15), foot: `${fmtPct(share(mas15, total))} de los pendientes`, alerta: mas15 > 0 },
  ];
  return (
    <ChartCard
      title="Pendientes por requisito"
      note="Cuántas ventas esperan documentos, qué se les pide y cuánto tiempo llevan. Cada venta cuenta una sola vez, en la combinación de documentos que debe (por ejemplo, Boleta + Recibo). Clic en una barra para ver esos clientes."
      actions={
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setLista({ titulo: "Todos los pendientes por requisito", filtro: () => true })} className="rounded-full border border-hair bg-white px-4 py-2 text-[13px] font-medium text-ink hover:border-ink-faint dark:bg-slate-900">
            Ver lista de clientes
          </button>
          <button type="button" onClick={() => descargar(r.clientes)} className="rounded-full border border-hair bg-white px-4 py-2 text-[13px] font-medium text-ink hover:border-ink-faint dark:bg-slate-900">
            Descargar
          </button>
        </div>
      }
    >
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-hair px-4 py-3">
            <p className="text-[12.5px] text-ink-soft">{k.label}</p>
            <p className={`mt-0.5 text-[26px] font-semibold tabular-nums ${k.alerta ? "text-[var(--st-critical)]" : "text-ink"}`}>{k.v}</p>
            <p className="text-[12px] text-ink-soft">{k.foot}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-10 xl:grid-cols-2">
        <div>
          <h3 className="mb-3 text-[13.5px] font-semibold text-ink">Qué documento se pide</h3>
          <BarList
            rows={r.porDocumento.map((d) => ({ label: d.label, value: d.clientes }))}
            total={total}
            onSelect={(x) => setLista({ titulo: `Deben: ${x.label}`, filtro: (c) => c.grupo === x.label })}
            selectHint="Ver estos clientes"
          />
        </div>
        <div>
          <h3 className="mb-3 text-[13.5px] font-semibold text-ink">Cuánto tiempo llevan pendientes</h3>
          <BarList
            rows={TRAMOS.map((t) => ({
              label: t.label,
              value: r.clientes.filter(enTramo(t)).length,
              color: t.de > 15 ? "var(--st-critical)" : t.de > 7 ? "var(--st-warning)" : "var(--st-good)",
            }))}
            total={total}
            onSelect={(x) => {
              const t = TRAMOS.find((y) => y.label === x.label)!;
              setLista({ titulo: `Pendientes ${t.label.toLowerCase()}`, filtro: enTramo(t) });
            }}
            selectHint="Ver estos clientes"
          />
        </div>
      </div>
      {lista && <ListaPendientes titulo={lista.titulo} filas={r.clientes.filter(lista.filtro)} dias={dias} onClose={() => setLista(null)} onDescargar={descargar} />}
    </ChartCard>
  );
}

/** Lista de clientes pendientes por requisito, en un panel lateral (para no saturar la pantalla). */
function ListaPendientes({
  titulo,
  filas,
  dias,
  onClose,
  onDescargar,
}: {
  titulo: string;
  filas: NonNullable<NonNullable<CampaignAnalysis["ventas"]>["requisitos"]>["clientes"];
  dias: (iso: string | null) => number | null;
  onClose: () => void;
  onDescargar: (filas: NonNullable<NonNullable<CampaignAnalysis["ventas"]>["requisitos"]>["clientes"]) => void;
}) {
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="fade-in absolute inset-0 bg-[#0e1b3d]/20 backdrop-blur-[2px] dark:bg-black/50" onClick={onClose} aria-hidden />
      <div className="drawer-in absolute inset-y-0 right-0 flex w-full max-w-[920px] flex-col border-l border-hair bg-white shadow-[-24px_0_48px_rgba(14,27,61,0.10)] dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4 border-b border-hair px-6 pt-6 pb-5">
          <div className="min-w-0">
            <h2 className="text-[20px] leading-tight font-semibold text-ink">{titulo}</h2>
            <p className="mt-1 text-[13px] text-ink-soft">
              <span className="font-medium text-ink tabular-nums">{fmtInt.format(filas.length)}</span> {filas.length === 1 ? "venta" : "ventas"} · ordenadas por días pendiente
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => onDescargar(filas)} className="rounded-full border border-hair bg-white px-4 py-2 text-[13px] font-medium text-ink hover:border-ink-faint dark:bg-slate-900">
              Descargar
            </button>
            <button type="button" onClick={onClose} className="rounded-full p-2 text-ink-soft hover:bg-paper hover:text-ink dark:hover:bg-slate-800" aria-label="Cerrar">
              ✕
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-6 pb-6">
          <DataTable
            rows={filas}
            maxRows={5000}
            cols={[
              { key: "niu", label: "NIU", render: (c) => c.niu },
              { key: "nombre", label: "Cliente", render: (c) => <span title={`${c.agente} · venta ${c.fecha ?? "sin fecha"}${c.origen === "cosecha" ? " (cosecha)" : ""}`}>{c.nombre ?? "—"}</span> },
              {
                key: "dias",
                label: "Días",
                align: "right",
                render: (c) => {
                  const d = dias(c.pendienteDesde);
                  return d === null ? "—" : <span className={d > 15 ? "font-semibold text-[var(--st-critical)]" : d > 7 ? "font-medium text-amber-700 dark:text-amber-300" : ""}>{fmtInt.format(d)}</span>;
                },
                sort: (c) => dias(c.pendienteDesde) ?? -1,
              },
              { key: "grupo", label: "Documentos que debe", render: (c) => c.grupo, sort: (c) => c.grupo },
            ]}
            initialSort="dias"
          />
        </div>
      </div>
    </div>
  );
}

/** Cuántas ventas hay en cada proceso: evaluadas (aprobadas + rechazadas), pendientes y % de aprobación, con total. */
function TablaProcesos({ titulo, nota, filas, cosecha = [], money, open }: { titulo: string; nota: string; filas: ProcesoRow[]; cosecha?: ProcesoRow[]; money: boolean; open: Ctx["open"] }) {
  const sumar = (lista: ProcesoRow[], proceso: string): ProcesoRow =>
    lista.reduce(
      (t, f) => ({
        proceso,
        ventas: t.ventas + f.ventas,
        aprobadas: t.aprobadas + f.aprobadas,
        rechazadas: t.rechazadas + f.rechazadas,
        pendientes: t.pendientes + f.pendientes,
        monto: t.monto + f.monto,
        montoAprobado: t.montoAprobado + f.montoAprobado,
      }),
      { proceso, ventas: 0, aprobadas: 0, rechazadas: 0, pendientes: 0, monto: 0, montoAprobado: 0 },
    );
  // Con cosecha: una fila más con todo lo de la sábana (lo vendido en el mes + lo vendido antes).
  const conCosecha = cosecha.length ? sumar([...filas, ...cosecha], "Total con cosecha") : null;
  const total: ProcesoRow = filas.reduce(
    (t, f) => ({
      proceso: "Total",
      ventas: t.ventas + f.ventas,
      aprobadas: t.aprobadas + f.aprobadas,
      rechazadas: t.rechazadas + f.rechazadas,
      pendientes: t.pendientes + f.pendientes,
      monto: t.monto + f.monto,
      montoAprobado: t.montoAprobado + f.montoAprobado,
    }),
    { proceso: "Total", ventas: 0, aprobadas: 0, rechazadas: 0, pendientes: 0, monto: 0, montoAprobado: 0 },
  );
  const rows = [...(filas.length > 1 || conCosecha ? [...filas, total] : filas), ...(conCosecha ? [conCosecha] : [])];
  const esTotal = (r: ProcesoRow) => r === total || r === conCosecha;
  const fuerte = (r: ProcesoRow, x: ReactNode) => (esTotal(r) ? <span className="font-semibold text-ink">{x}</span> : x);
  return (
    <ChartCard title={titulo} note={`${nota} Evaluadas = aprobadas + rechazadas; % de aprobación = aprobadas ÷ evaluadas.`}>
      <DataTable
        rows={rows}
        onRowClick={(r) => (!esTotal(r) && r.proceso !== "Sin proceso" ? open({ fuente: "ventas", title: `Proceso ${r.proceso}`, filters: { proceso: r.proceso } }) : undefined)}
        rowHint="Ver las ventas de este proceso"
        cols={[
          { key: "proceso", label: "Proceso", render: (r) => fuerte(r, r.proceso) },
          { key: "ventas", label: "Ventas", align: "right", render: (r) => fuerte(r, fmtInt.format(r.ventas)) },
          { key: "evaluadas", label: "Evaluadas", align: "right", render: (r) => fuerte(r, fmtInt.format(r.aprobadas + r.rechazadas)) },
          { key: "aprobadas", label: "Aprobadas", align: "right", render: (r) => fuerte(r, fmtInt.format(r.aprobadas)) },
          { key: "rechazadas", label: "Rechazadas", align: "right", render: (r) => fuerte(r, fmtInt.format(r.rechazadas)) },
          { key: "pendientes", label: "Pendientes", align: "right", render: (r) => fuerte(r, fmtInt.format(r.pendientes)) },
          ...(money
            ? [
                { key: "monto", label: "Monto", align: "right" as const, render: (r: ProcesoRow) => fuerte(r, fmtMoney(r.monto)) },
                { key: "montoAprobado", label: "Monto aprobado", align: "right" as const, render: (r: ProcesoRow) => fuerte(r, fmtMoney(r.montoAprobado)) },
              ]
            : []),
          {
            key: "aprobacion",
            label: "% Aprobación",
            align: "right",
            render: (r) => fuerte(r, r.aprobadas + r.rechazadas ? fmtPct(share(r.aprobadas, r.aprobadas + r.rechazadas)) : "—"),
          },
        ]}
      />
    </ChartCard>
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
          // Recorrido y toques, con las tipificaciones del mes.
          ...(b.recorridos
            ? [
                {
                  label: "Recorrido de la base",
                  num: b.recorridos.recorrido,
                  format: pct1,
                  foot: `${fmtInt.format(b.recorridos.clientes)} de ${fmtInt.format(b.total)} clientes llamados`,
                  delta: deltaOf(b.recorridos.recorrido, prev?.base?.recorridos?.recorrido, vs, { rate: true }),
                },
                {
                  label: "Promedio de toques",
                  num: b.recorridos.promedioToques,
                  format: dec1,
                  foot: `${fmtInt.format(b.recorridos.toques)} llamadas a clientes de la base`,
                  delta: deltaOf(b.recorridos.promedioToques, prev?.base?.recorridos?.promedioToques, vs, { upIsGood: null }),
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

      {(b.porCarga.length > 1 || b.recorridos) && (
        <ChartCard
          title={b.porCarga.length > 1 ? "Bases del mes" : "Recorrido de la base"}
          note={
            b.porCarga.length > 1
              ? "La original y las adicionales, en orden de llegada. Un cliente que viene en varias se cuenta en la primera que lo trajo; recorrido, toques, contacto y ventas son de sus clientes nuevos. Clic para ver los clientes de cada base."
              : "Recorrido: clientes de la base llamados al menos una vez. Toques: llamadas de la tipificación a esos clientes; el promedio es toques ÷ clientes recorridos."
          }
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
                      label: "Recorridos",
                      align: "right" as const,
                      render: (r: (typeof b.porCarga)[number]) => `${fmtInt.format(r.llamados)} (${fmtPct(r.recorrido, 0)})`,
                      sort: (r: (typeof b.porCarga)[number]) => r.recorrido,
                    },
                    {
                      key: "sinRecorrer",
                      label: "Sin recorrer",
                      align: "right" as const,
                      render: (r: (typeof b.porCarga)[number]) => fmtInt.format(r.nuevos - r.llamados),
                      sort: (r: (typeof b.porCarga)[number]) => r.nuevos - r.llamados,
                    },
                    {
                      key: "toques",
                      label: "Toques",
                      align: "right" as const,
                      render: (r: (typeof b.porCarga)[number]) => fmtInt.format(r.toques),
                      sort: (r: (typeof b.porCarga)[number]) => r.toques,
                    },
                    {
                      key: "promedioToques",
                      label: "Prom. toques",
                      align: "right" as const,
                      render: (r: (typeof b.porCarga)[number]) => dec1(r.promedioToques),
                      sort: (r: (typeof b.porCarga)[number]) => r.promedioToques,
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

      {b.cuadre && <CuadreTipificacion c={b.cuadre} bases={b.porCarga.map((x) => ({ nombre: x.adicional ? x.nombre || "Base adicional" : label(x.dataset), toques: x.toques }))} />}

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

/** Cuadre de los toques con el archivo de tipificaciones: cada llamada va a una base, fuera de base o sin NIU. */
function CuadreTipificacion({ c, bases }: { c: NonNullable<NonNullable<CampaignAnalysis["base"]>["cuadre"]>; bases: { nombre: string; toques: number }[] }) {
  const suma = c.aBase + c.fueraDeBase + c.sinNiu;
  const cuadra = suma === c.llamadas;
  const filas: { label: string; n: number; nota?: string }[] = [
    ...bases.map((x) => ({ label: `A clientes de ${x.nombre}`, n: x.toques })),
    { label: "A clientes que no vienen en ninguna base del mes", n: c.fueraDeBase, nota: c.clientesFuera ? `${fmtInt.format(c.clientesFuera)} clientes` : undefined },
    { label: "Sin NIU", n: c.sinNiu },
  ];
  return (
    <ChartCard title="Cuadre con la tipificación" note="Cada llamada del archivo de tipificaciones del mes se cuenta una sola vez: en la base de su cliente, fuera de base o sin NIU.">
      <dl className="divide-y divide-hair text-[14px]">
        {filas.map((f) => (
          <div key={f.label} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="text-ink-soft">
              {f.label}
              {f.nota && <span className="ml-2 text-[12px]">({f.nota})</span>}
            </dt>
            <dd className="tabular-nums text-ink">{fmtInt.format(f.n)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 py-2 font-semibold">
          <dt className="text-ink">Llamadas en la tipificación</dt>
          <dd className="tabular-nums text-ink">{fmtInt.format(c.llamadas)}</dd>
        </div>
      </dl>
      <p className={`mt-3 text-[13px] font-medium ${cuadra ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}>
        {cuadra ? "Cuadra: la suma de los toques da el total de llamadas del archivo." : `No cuadra: la suma da ${fmtInt.format(suma)} y el archivo tiene ${fmtInt.format(c.llamadas)} llamadas.`}
      </p>
    </ChartCard>
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
    { key: "aprobacion", title: "% Aprobación", value: (m) => m.aprobacion, format: pct1, axis: pctAxis, rate: true, note: `Aprobadas sobre las evaluadas (${evaluacionDe(a.campaign).evaluadas.toLowerCase()})` },
    {
      key: "rechazo",
      title: "% Rechazo",
      value: (m: MonthSummary) => (m.aprobadas !== null && m.rechazadas !== null && m.aprobadas + m.rechazadas > 0 ? share(m.rechazadas, m.aprobadas + m.rechazadas) : null),
      format: pct1,
      axis: pctAxis,
      rate: true,
      upIsGood: false,
      note: `Rechazadas sobre las evaluadas (${evaluacionDe(a.campaign).evaluadas.toLowerCase()})`,
    },
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
  // Evaluadas = aprobadas + rechazadas (en TC, ya pasaron por PCBM).
  const evaluadasDe = (r: R) => (r.aprobadas === null || r.rechazadas === null ? null : r.aprobadas + r.rechazadas);
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
            // Ventas del mes completo → evaluadas (ya resueltas; en TC, ya pasaron por PCBM) → aprobadas → rechazadas → pendientes → % sobre evaluadas.
            ...[
                  { key: "ventas", label: "Ventas", align: "right" as const, render: (r: R) => opt(r.ventas, (x) => fmtInt.format(x)), sort: (r: R) => r.ventas ?? -1 },
                  { key: "evaluadas", label: "Evaluadas", align: "right" as const, render: (r: R) => opt(evaluadasDe(r), (x) => fmtInt.format(x)), sort: (r: R) => evaluadasDe(r) ?? -1 },
                  { key: "aprobadas", label: "Aprobadas", align: "right" as const, render: (r: R) => opt(r.aprobadas, (x) => fmtInt.format(x)), sort: (r: R) => r.aprobadas ?? -1 },
                  { key: "rechazadas", label: "Rechazadas", align: "right" as const, render: (r: R) => opt(r.rechazadas, (x) => fmtInt.format(x)), sort: (r: R) => r.rechazadas ?? -1 },
                  {
                    key: "pendientes",
                    label: "Pendientes",
                    align: "right" as const,
                    render: (r: R) => opt(r.ventas !== null && evaluadasDe(r) !== null ? r.ventas - evaluadasDe(r)! : null, (x) => fmtInt.format(x)),
                    sort: (r: R) => (r.ventas !== null && evaluadasDe(r) !== null ? r.ventas - evaluadasDe(r)! : -1),
                  },
                  { key: "aprobacion", label: "% Aprobación", align: "right" as const, render: (r: R) => (evaluadasDe(r) ? fmtPct(r.aprobacion!) : "—"), sort: (r: R) => r.aprobacion ?? -1 },
                  {
                    key: "rechazo",
                    label: "% Rechazo",
                    align: "right" as const,
                    render: (r: R) => (evaluadasDe(r) ? fmtPct(share(r.rechazadas!, evaluadasDe(r)!)) : "—"),
                    sort: (r: R) => (evaluadasDe(r) ? share(r.rechazadas!, evaluadasDe(r)!) : -1),
                  },
                ],
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
            ...(meses.some((m) => m.oficial && m.logradoSabana != null)
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

/* ---------- evaluadas, por campaña ---------- */

/**
 * Cómo se lee "evaluada" en cada campaña: ya tiene resolución del banco (aprobada o rechazada) según sus estatus.
 * En TC, la resolución es PCBM. Pendientes: todo lo demás.
 */
function evaluacionDe(code: string): { titulo: string; cosa: string; evaluadas: string; pendientes: string; aprobadas: string; rechazadas: string } {
  if (!isCampaignCode(code)) return { titulo: "Evaluación del banco", cosa: "Ventas", evaluadas: "Ya resueltas por el banco", pendientes: "Aún sin resolución del banco", aprobadas: "", rechazadas: "" };
  const c = getCampaign(code as CampaignCode);
  const lista = (xs: readonly string[]) => xs.map((x) => x.charAt(0) + x.slice(1).toLowerCase()).join(", ");
  if (code === "tdc")
    return {
      titulo: "Evaluación PCBM",
      cosa: "TC",
      evaluadas: "Ya pasaron por PCBM",
      pendientes: "Aún no pasan por PCBM",
      aprobadas: "entregada, en distribución, sin embozo, devolución…",
      rechazadas: "rechazada",
    };
  return {
    titulo: "Evaluación del banco",
    cosa: "Ventas",
    evaluadas: "Ya resueltas por el banco",
    pendientes: "Aún sin resolución del banco",
    aprobadas: lista(c.approved).toLowerCase(),
    rechazadas: lista(c.rejected).toLowerCase(),
  };
}

/* ---------- Comparativo ---------- */

type Fila = { sec: string; label: string; a: number | null; b: number | null; tipo: "n" | "pct" | "money" | "dec"; upIsGood?: boolean | null; nota?: string };

/**
 * Un mes a la par del otro con los mismos días (el filtro de días): cómo íbamos contra cómo vamos. Si el mes va en
 * curso y no se eligieron días, se pone solo del 1 al último día con datos, para comparar a la misma fecha.
 */
function ComparativoTab({ a, prev, setDias, open, desglosar }: Ctx) {
  const ultimo = a.month ? new Date(Date.UTC(Number(a.month.slice(0, 4)), Number(a.month.slice(5, 7)), 0)).getUTCDate() : 31;
  const diaDatos = a.month && a.fechas.hasta?.startsWith(a.month) ? Number(a.fechas.hasta.slice(8, 10)) : null;
  const puesto = useRef(false);
  useEffect(() => {
    if (puesto.current) return;
    puesto.current = true;
    if (!a.dias && a.month === currentMonth() && diaDatos && diaDatos < ultimo) setDias({ desde: 1, hasta: diaDatos });
  }, [a.dias, a.month, diaDatos, ultimo, setDias]);

  const otros = a.months.filter((m) => m !== a.month);
  const [contra, setContra] = useState<string | null>(null);
  const mesB = contra && otros.includes(contra) ? contra : (prev?.month ?? otros.find((m) => a.month && m < a.month) ?? otros[0] ?? null);
  const dias = a.dias ? { desde: a.dias.desde, hasta: a.dias.hasta } : null;
  const qb = useQuery({ ...consultaAnalisis(a.campaign, mesB, a.agente, dias), enabled: Boolean(mesB) });
  const b = qb.data?.month === mesB ? qb.data : undefined;

  const eva = evaluacionDe(a.campaign);
  const money = isCampaignCode(a.campaign) && GOAL_UNIT[a.campaign] === "monto";
  const nombreA = a.month ? monthLabel(a.month) : "";
  const nombreB = mesB ? monthLabel(mesB) : "";
  const rango = (x: CampaignAnalysis | undefined) => (x?.dias ? (x.dias.desde === x.dias.hasta ? `día ${x.dias.desde}` : `del ${x.dias.desde} al ${x.dias.hasta}`) : "mes completo");
  const v = (x: CampaignAnalysis | undefined) => x?.ventas ?? null;
  const ev = (x: CampaignAnalysis | undefined) => (v(x) ? v(x)!.aprobadas + v(x)!.rechazadas : null);
  const sh = (n: number | null | undefined, d: number | null | undefined) => (n === null || n === undefined || !d ? null : share(n, d));
  const filas = (
    [
    { sec: "Ventas", label: "Ventas (toda la sábana)", a: v(a)?.total ?? null, b: v(b)?.total ?? null, tipo: "n", upIsGood: true },
    { sec: "Ventas", label: "Vendidas en el mes", a: v(a) ? v(a)!.total - v(a)!.cosecha.total : null, b: v(b) ? v(b)!.total - v(b)!.cosecha.total : null, tipo: "n", upIsGood: true },
    { sec: "Ventas", label: "Cosecha (meses anteriores)", a: v(a)?.cosecha.total ?? null, b: v(b)?.cosecha.total ?? null, tipo: "n", upIsGood: null },
    { sec: "Ventas", label: "Evaluadas", a: ev(a), b: ev(b), tipo: "n", upIsGood: true, nota: eva.evaluadas },
    { sec: "Ventas", label: "Aprobadas", a: v(a)?.aprobadas ?? null, b: v(b)?.aprobadas ?? null, tipo: "n", upIsGood: true, nota: eva.aprobadas },
    { sec: "Ventas", label: "Rechazadas", a: v(a)?.rechazadas ?? null, b: v(b)?.rechazadas ?? null, tipo: "n", upIsGood: false, nota: eva.rechazadas },
    { sec: "Ventas", label: "Pendientes", a: v(a)?.enProceso ?? null, b: v(b)?.enProceso ?? null, tipo: "n", upIsGood: null, nota: eva.pendientes },
    { sec: "Ventas", label: "% Aprobación (sobre evaluadas)", a: v(a)?.aprobacion ?? null, b: v(b)?.aprobacion ?? null, tipo: "pct", upIsGood: true },
    { sec: "Ventas", label: "% Rechazo (sobre evaluadas)", a: sh(v(a)?.rechazadas, ev(a)), b: sh(v(b)?.rechazadas, ev(b)), tipo: "pct", upIsGood: false },
    ...(money
      ? ([
          { sec: "Ventas", label: "Monto", a: v(a)?.monto.total ?? null, b: v(b)?.monto.total ?? null, tipo: "money", upIsGood: true },
          { sec: "Ventas", label: "Monto aprobado", a: v(a)?.monto.aprobado ?? null, b: v(b)?.monto.aprobado ?? null, tipo: "money", upIsGood: true },
        ] as Fila[])
      : []),
    {
      sec: "Cumplimiento",
      label: "Lo que cuenta para la meta",
      a: a.cumplimiento.ventas,
      b: b?.cumplimiento.ventas ?? null,
      tipo: a.cumplimiento.unidad === "monto" ? "money" : "n",
      upIsGood: true,
    },
    { sec: "Cumplimiento", label: "Meta del mes", a: a.cumplimiento.meta, b: b?.cumplimiento.meta ?? null, tipo: a.cumplimiento.unidad === "monto" ? "money" : "n", upIsGood: null },
    { sec: "Cumplimiento", label: "Avance sobre la meta del mes", a: a.cumplimiento.avance, b: b?.cumplimiento.avance ?? null, tipo: "pct", upIsGood: true },
    { sec: "Cumplimiento", label: "Avance sobre lo esperado a la fecha", a: a.cumplimiento.avanceMTD, b: b?.cumplimiento.avanceMTD ?? null, tipo: "pct", upIsGood: true, nota: "Meta repartida por días hábiles hasta el último día con ventas" },
    { sec: "Llamadas", label: "Llamadas", a: a.llamadas?.total ?? null, b: b?.llamadas?.total ?? null, tipo: "n", upIsGood: true },
    { sec: "Llamadas", label: "Clientes llamados", a: a.llamadas?.registros ?? null, b: b?.llamadas?.registros ?? null, tipo: "n", upIsGood: true },
    { sec: "Llamadas", label: "Contactabilidad", a: a.llamadas?.contactabilidad ?? null, b: b?.llamadas?.contactabilidad ?? null, tipo: "pct", upIsGood: true },
    { sec: "Llamadas", label: "Ventas en la tipificación", a: a.llamadas?.ventasUnicas ?? null, b: b?.llamadas?.ventasUnicas ?? null, tipo: "n", upIsGood: true },
    { sec: "Llamadas", label: "Penetración de la base", a: a.llamadas?.penetracion ?? null, b: b?.llamadas?.penetracion ?? null, tipo: "pct", upIsGood: true },
    { sec: "Base", label: "Clientes en la base", a: a.base?.total ?? null, b: b?.base?.total ?? null, tipo: "n", upIsGood: null, nota: "La base no tiene fecha: es la del mes completo" },
    { sec: "Base", label: "Recorrido de la base", a: a.base?.recorridos?.recorrido ?? null, b: b?.base?.recorridos?.recorrido ?? null, tipo: "pct", upIsGood: true },
    { sec: "Base", label: "Promedio de toques", a: a.base?.recorridos?.promedioToques ?? null, b: b?.base?.recorridos?.promedioToques ?? null, tipo: "dec", upIsGood: null },
    { sec: "CRM", label: "Ventas capturadas en el CRM", a: a.crm?.total ?? null, b: b?.crm?.total ?? null, tipo: "n", upIsGood: true },
    ] as Fila[]
  ).filter((f) => f.a !== null || f.b !== null);

  const fmt = (t: Fila["tipo"], n: number | null) => (n === null ? "—" : t === "pct" ? fmtPct(n) : t === "money" ? fmtMoney(n) : t === "dec" ? dec1(n) : fmtInt.format(n));
  const corto = (m: string) => monthLabel(m).split(" ")[0]!;
  const cortoA = a.month ? corto(a.month) : "";
  const cortoB = mesB ? corto(mesB) : "";
  const vsB = `vs ${cortoB}`;

  // Ejecutivos: ventas y aprobadas de cada uno, un mes a la par del otro.
  const agentes = [...new Set([...(v(a)?.porEjecutivo ?? []).map((x) => x.agent), ...(v(b)?.porEjecutivo ?? []).map((x) => x.agent)])];
  const ejA = new Map((v(a)?.porEjecutivo ?? []).map((x) => [x.agent, x]));
  const ejB = new Map((v(b)?.porEjecutivo ?? []).map((x) => [x.agent, x]));
  const ejecutivos = agentes
    .map((agent) => ({ agent, a: ejA.get(agent), b: ejB.get(agent) }))
    .sort((x, y) => (y.a?.ventas ?? 0) - (x.a?.ventas ?? 0) || (y.b?.ventas ?? 0) - (x.b?.ventas ?? 0));
  const maxEj = Math.max(1, ...ejecutivos.flatMap((e) => [e.a?.ventas ?? 0, e.b?.ventas ?? 0]));

  const secciones = [...new Set(filas.map((f) => f.sec))];
  // Dos barras, una sobre otra: el mes que se ve (azul) y el de comparación (gris), a la misma escala.
  const Barras = ({ f }: { f: Fila }) => {
    const max = f.tipo === "pct" ? Math.max(100, f.a ?? 0, f.b ?? 0) : Math.max(f.a ?? 0, f.b ?? 0) || 1;
    const fila = (n: number | null, mes: string, color: string, fuerte: boolean) => (
      <div className="grid grid-cols-[2.25rem_1fr_auto] items-center gap-3">
        <span className={`text-[12px] first-letter:uppercase ${fuerte ? "font-medium text-ink" : "text-ink-soft"}`}>{mes}</span>
        <span className="h-2 overflow-hidden rounded-full bg-[var(--viz-grid)]">
          <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${n === null ? 0 : Math.max(1.5, (n / max) * 100)}%`, background: color }} />
        </span>
        <span className={`min-w-[4.5rem] text-right text-[13px] tabular-nums ${fuerte ? "font-semibold text-ink" : "text-ink-soft"}`}>{fmt(f.tipo, n)}</span>
      </div>
    );
    return (
      <div className="space-y-2">
        {fila(f.a, cortoA.slice(0, 3), "var(--viz-1)", true)}
        {fila(f.b, cortoB ? cortoB.slice(0, 3) : "—", "var(--viz-text)", false)}
      </div>
    );
  };
  const diferencia = (f: Fila) => {
    if (f.a === null || f.b === null) return null;
    const d = f.a - f.b;
    if (d === 0) return "Igual";
    return f.tipo === "pct" ? `${d > 0 ? "+" : "−"}${fmtNum(Math.abs(d), 1)} pts` : `${d > 0 ? "+" : "−"}${fmt(f.tipo, Math.abs(d))}`;
  };

  // El resumen de arriba: lo que más se mira, con clic para ver cuáles son (del mes que se está viendo).
  const ventasDe = (titulo: string, clase?: SaleClass[]) => () => desglosar(titulo, clase ?? null);
  const resumen: (Fila & { abrir?: () => void })[] = [
    { sec: "", label: "Ventas", a: v(a)?.total ?? null, b: v(b)?.total ?? null, tipo: "n", upIsGood: true, nota: "toda la sábana, con cosecha", abrir: ventasDe("Ventas del mes") },
    { sec: "", label: "Evaluadas", a: ev(a), b: ev(b), tipo: "n", upIsGood: true, nota: eva.evaluadas.toLowerCase(), abrir: ventasDe(`${eva.cosa} evaluadas`, ["aprobado", "rechazado"]) },
    { sec: "", label: "Aprobadas", a: v(a)?.aprobadas ?? null, b: v(b)?.aprobadas ?? null, tipo: "n", upIsGood: true, nota: eva.aprobadas, abrir: ventasDe(`${eva.cosa} aprobadas`, ["aprobado"]) },
    { sec: "", label: "Rechazadas", a: v(a)?.rechazadas ?? null, b: v(b)?.rechazadas ?? null, tipo: "n", upIsGood: false, nota: eva.rechazadas, abrir: ventasDe(`${eva.cosa} rechazadas`, ["rechazado"]) },
    { sec: "", label: "Pendientes", a: v(a)?.enProceso ?? null, b: v(b)?.enProceso ?? null, tipo: "n", upIsGood: null, nota: eva.pendientes.toLowerCase(), abrir: ventasDe(`${eva.cosa} pendientes`, ["en_proceso"]) },
    ...(money
      ? ([
          { sec: "", label: "Monto aprobado", a: v(a)?.monto.aprobado ?? null, b: v(b)?.monto.aprobado ?? null, tipo: "money", upIsGood: true, abrir: ventasDe(`${eva.cosa} aprobadas`, ["aprobado"]) },
        ] as (Fila & { abrir?: () => void })[])
      : []),
    { sec: "", label: "% Aprobación", a: v(a)?.aprobacion ?? null, b: v(b)?.aprobacion ?? null, tipo: "pct", upIsGood: true, nota: "aprobadas ÷ evaluadas" },
    { sec: "", label: "% Rechazo", a: sh(v(a)?.rechazadas, ev(a)), b: sh(v(b)?.rechazadas, ev(b)), tipo: "pct", upIsGood: false, nota: "rechazadas ÷ evaluadas" },
  ];

  return (
    <Stack>
      {/* Los dos meses frente a frente y contra cuál se compara. */}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-stretch">
        <div className="rounded-2xl border border-[var(--viz-1)]/40 bg-[var(--viz-1-wash)] px-6 py-5">
          <p className="text-[12px] text-ink-soft">Estás viendo</p>
          <p className="mt-1 text-[22px] font-semibold text-ink first-letter:uppercase">{nombreA}</p>
          <p className="text-[13px] text-ink-soft">{rango(a)}</p>
        </div>
        <div className="flex items-center justify-center text-[13px] font-medium text-ink-soft">vs</div>
        <div className="rounded-2xl border border-hair bg-white px-6 py-5 dark:bg-slate-900">
          <div className="flex items-start justify-between gap-3">
            <p className="text-[12px] text-ink-soft">Comparado con</p>
            {otros.length > 1 && (
              <select aria-label="Mes con el que se compara" value={mesB ?? ""} onChange={(e) => setContra(e.target.value)} className="-mt-1 rounded-full border border-hair bg-white px-2.5 py-0.5 text-[12px] text-ink dark:bg-slate-900">
                {otros.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            )}
          </div>
          <p className="mt-1 text-[22px] font-semibold text-ink first-letter:uppercase">{nombreB || "—"}</p>
          <p className="text-[13px] text-ink-soft">{b ? rango(b) : rango(a)}</p>
        </div>
      </div>
      {!mesB && <Aside>Para comparar hace falta otro mes con archivos.</Aside>}
      {qb.isError && <ErrorMessage>{qb.error.message}</ErrorMessage>}
      {mesB && !b && qb.isFetching && <p className="text-sm text-ink-soft">Calculando {nombreB}…</p>}

      {/* Lo principal, un mes a la par del otro: evaluadas, aprobadas, rechazadas, pendientes y los %. */}
      {v(a) && (
        <div className="overflow-hidden rounded-2xl border border-hair bg-white dark:bg-slate-900">
          <div className="grid grid-cols-[minmax(9rem,1.4fr)_1fr_1fr_1fr] items-end gap-x-4 border-b border-hair px-6 pt-5 pb-3 text-[12px] text-ink-soft">
            <span className="text-[15px] font-semibold text-ink">{eva.titulo}</span>
            <span className="text-right">
              <span className="block font-medium text-[var(--viz-1)] first-letter:uppercase">{nombreA}</span>
              {rango(a)}
            </span>
            <span className="text-right">
              <span className="block font-medium text-ink first-letter:uppercase">{nombreB || "—"}</span>
              {b ? rango(b) : rango(a)}
            </span>
            <span className="text-right">Cambio</span>
          </div>
          <ul className="divide-y divide-hair">
            {resumen.map((f) => {
              const d = deltaOf(f.a, f.b, "", { rate: f.tipo === "pct", upIsGood: f.upIsGood ?? null });
              const tono = !d || d.good === null ? "text-ink-soft" : d.good ? "text-[var(--st-good)]" : "text-[var(--st-critical)]";
              const contenido = (
                <>
                  <span className="text-[14px] text-ink">
                    {f.label}
                    {f.nota && <span className="block text-[12px] text-ink-soft">{f.nota}</span>}
                  </span>
                  <span className="text-right text-[24px] leading-none font-semibold tabular-nums text-ink">{fmt(f.tipo, f.a)}</span>
                  <span className="text-right text-[20px] leading-none tabular-nums text-ink-soft">{fmt(f.tipo, f.b)}</span>
                  <span className={`text-right text-[13px] tabular-nums ${tono}`}>
                    {diferencia(f) ?? "—"}
                    {d && f.tipo !== "pct" && (
                      <span className="block text-[12px]">
                        {d.dir === "up" ? "↑" : d.dir === "down" ? "↓" : "="} {d.text}
                      </span>
                    )}
                  </span>
                </>
              );
              const clase = "grid w-full grid-cols-[minmax(9rem,1.4fr)_1fr_1fr_1fr] items-center gap-x-4 px-6 py-3.5 text-left";
              return (
                <li key={f.label}>
                  {f.abrir ? (
                    <button type="button" onClick={f.abrir} title={`Ver cuáles son (${nombreA})`} className={`${clase} transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/40`}>
                      {contenido}
                    </button>
                  ) : (
                    <div className={clase}>{contenido}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {secciones.map((sec) => (
        <section key={sec} aria-labelledby={`cmp-${sec}`}>
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 id={`cmp-${sec}`} className="text-[15px] font-semibold text-ink">
              {sec}
            </h2>
            {sec === "Ventas" && (
              <p className="text-[12px] text-ink-soft">
                Evaluadas: {eva.evaluadas.toLowerCase()} (aprobadas: {eva.aprobadas}; rechazadas: {eva.rechazadas}). Los % son sobre las evaluadas.
              </p>
            )}
            {sec === "Base" && <p className="text-[12px] text-ink-soft">La base no tiene fecha: es la del mes completo.</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filas
              .filter((f) => f.sec === sec)
              .map((f) => {
                const d = deltaOf(f.a, f.b, vsB, { rate: f.tipo === "pct", upIsGood: f.upIsGood ?? null });
                const dif = diferencia(f);
                return (
                  <div key={f.label} className="rounded-2xl border border-hair bg-white p-5 dark:bg-slate-900" title={f.nota}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[13px] text-ink-soft">{f.label}</p>
                      {d && <DeltaBadge d={d} />}
                    </div>
                    <div className="mt-1 mb-4 flex items-baseline gap-3">
                      <span className="text-[26px] leading-tight font-semibold tabular-nums text-ink">{fmt(f.tipo, f.a)}</span>
                      {dif && <span className="text-[13px] tabular-nums text-ink-soft">{dif}</span>}
                    </div>
                    <Barras f={f} />
                  </div>
                );
              })}
          </div>
        </section>
      ))}

      {ejecutivos.length > 0 && (
        <ChartCard title="Por ejecutivo" note={`Ventas de cada ejecutivo con los mismos días: ${cortoA} en azul, ${cortoB} en gris. Clic para ver sus ventas de ${cortoA}.`}>
          <ul className="divide-y divide-hair">
            {ejecutivos.map((e) => {
              const va = e.a?.ventas ?? 0;
              const vb = e.b?.ventas ?? 0;
              const d = va - vb;
              return (
                <li key={e.agent}>
                  <button
                    type="button"
                    onClick={() => open({ fuente: "ventas", title: `Ventas de ${e.agent}`, filters: { agente: e.agent } })}
                    className="grid w-full grid-cols-[minmax(8rem,14rem)_1fr_auto] items-center gap-4 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    title={`Aprobadas: ${fmtInt.format(e.a?.aprobadas ?? 0)} en ${cortoA}, ${fmtInt.format(e.b?.aprobadas ?? 0)} en ${cortoB}`}
                  >
                    <span className="truncate text-[13.5px] text-ink">{e.agent}</span>
                    <span className="space-y-1">
                      <span className="block h-2 rounded-full bg-[var(--viz-1)]" style={{ width: `${Math.max(1, (va / maxEj) * 100)}%` }} />
                      <span className="block h-2 rounded-full bg-[var(--viz-text)]" style={{ width: `${Math.max(1, (vb / maxEj) * 100)}%` }} />
                    </span>
                    <span className="flex min-w-[9rem] items-baseline justify-end gap-3 text-[13px] tabular-nums">
                      <span className="font-semibold text-ink">{fmtInt.format(va)}</span>
                      <span className="text-ink-soft">{fmtInt.format(vb)}</span>
                      <span className={`w-10 text-right ${d === 0 ? "text-ink-soft" : d > 0 ? "text-[var(--st-good)]" : "text-[var(--st-critical)]"}`}>{d === 0 ? "=" : `${d > 0 ? "+" : "−"}${fmtInt.format(Math.abs(d))}`}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </ChartCard>
      )}
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
        Estás viendo <span className="font-medium text-ink">{monthLabel(a.month)}</span>
        {a.dias ? (
          <>
            , <span className="font-medium text-ink">{a.dias.desde === a.dias.hasta ? `solo el día ${a.dias.desde}` : `del día ${a.dias.desde} al ${a.dias.hasta}`}</span>
            {a.dias.desde === 1 && " (con la cosecha de meses anteriores)"}
          </>
        ) : (
          <>, {state}</>
        )}
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

/* ---------- rango de días ---------- */

function leerDias(params: URLSearchParams): Dias {
  const d = Number(params.get("desde"));
  const h = Number(params.get("hasta"));
  if (!params.get("desde") && !params.get("hasta")) return null;
  const desde = Number.isInteger(d) && d >= 1 && d <= 31 ? d : 1;
  const hasta = Number.isInteger(h) && h >= desde && h <= 31 ? h : 31;
  return desde === 1 && hasta === 31 ? null : { desde, hasta };
}

/**
 * Días del mes a mirar: "Todo el mes" o del día X al día Y. Con un rango, ventas, llamadas, CRM y cumplimiento
 * se cuentan solo con fecha en esos días, y el mes anterior con los mismos días (para comparar al mismo corte).
 */
function DiasPicker({ month, value, hastaDatos, onChange }: { month: string; value: Dias; hastaDatos: string | null; onChange: (d: Dias) => void }) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const desde = Math.min(value?.desde ?? 1, ultimo);
  const hasta = Math.min(value?.hasta ?? ultimo, ultimo);
  const dia = hastaDatos?.startsWith(month) ? Number(hastaDatos.slice(8, 10)) : null;
  const poner = (d: number, h: number) => onChange(d === 1 && h >= ultimo ? null : { desde: d, hasta: Math.max(d, h) });
  const opciones = Array.from({ length: ultimo }, (_, i) => i + 1);
  const sel = "rounded-full border border-hair bg-white px-2.5 py-1 text-[13px] text-ink tabular-nums dark:bg-slate-900";
  return (
    <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-soft" role="group" aria-label="Días del mes">
      <span>Días</span>
      <select aria-label="Desde el día" className={sel} value={desde} onChange={(e) => poner(Number(e.target.value), Math.max(Number(e.target.value), hasta))}>
        {opciones.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      <span>al</span>
      <select aria-label="Hasta el día" className={sel} value={hasta} onChange={(e) => poner(Math.min(desde, Number(e.target.value)), Number(e.target.value))}>
        {opciones.map((d) => (
          <option key={d} value={d}>
            {d}
          </option>
        ))}
      </select>
      {value ? (
        <button type="button" onClick={() => onChange(null)} className="font-medium text-brand-600 hover:underline">
          Todo el mes
        </button>
      ) : (
        dia &&
        dia < ultimo && (
          <button type="button" onClick={() => poner(1, dia)} className="font-medium text-brand-600 hover:underline" title="Este mes y el anterior, del día 1 al último día con datos">
            Comparar al día {dia}
          </button>
        )
      )}
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
  // Rango de días (?desde=1&hasta=12): todo se calcula con esos días y el mes anterior con los mismos, para comparar.
  const dias = leerDias(params);
  const valid = isCampaignCode(code);
  const analysis = useQuery({
    ...consultaAnalisis(code, requested, agent, dias),
    enabled: valid,
    // Al cambiar de mes o de agente se queda lo anterior en pantalla hasta que llega lo nuevo
    // (pero nunca las cifras de otra campaña).
    placeholderData: (anterior, consulta) => (consulta?.queryKey[1] === code ? keepPreviousData(anterior) : undefined),
  });
  const a = analysis.data;
  const prevMonth = mesAnterior(a);
  const prev = useQuery({
    ...consultaAnalisis(code, prevMonth ?? null, agent, dias),
    enabled: valid && Boolean(prevMonth),
  });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 5 * 60_000 });
  const [detail, setDetail] = useState<DetailSpec | null>(null);
  const [desglose, setDesglose] = useState<DesgloseSpec | null>(null);
  // El histórico de esta campaña se deja listo cuando ya llegó lo de la pantalla (no antes: no se le pide todo junto a la base).
  const listo = Boolean(a) && !analysis.isFetching && !prev.isFetching;
  useEffect(() => {
    if (valid && listo && !agent) void qc.prefetchQuery(consultaHistorico(code)).catch(() => {});
  }, [valid, listo, agent, code, qc]);

  const setQuery = useCallback(
    (next: { mes?: string | null; agente?: string | null; dias?: Dias }) => {
      const mes = next.mes === undefined ? (a?.month ?? requested) : next.mes;
      const agente = next.agente === undefined ? agent : next.agente;
      const rango = next.dias === undefined ? dias : next.dias;
      const q: Record<string, string> = {};
      if (mes) q.mes = mes;
      if (agente) q.agente = agente;
      if (rango) {
        q.desde = String(rango.desde);
        q.hasta = String(rango.hasta);
      }
      setParams(q);
    },
    [a?.month, requested, agent, dias, setParams],
  );
  const closeDetail = useCallback(() => setDetail(null), []);

  if (!valid) return <Navigate to="/" replace />;
  const current = CAMPAIGN_TABS.find((t) => t.slug === tab);
  if (!current) return <Navigate to={`/campanas/${code}/ventas${requested ? `?mes=${requested}` : ""}`} replace />;
  const campaign = getCampaign(code);
  const qsParams = new URLSearchParams();
  if (a?.month) qsParams.set("mes", a.month);
  if (agent) qsParams.set("agente", agent);
  if (dias) {
    qsParams.set("desde", String(dias.desde));
    qsParams.set("hasta", String(dias.hasta));
  }
  const qs = qsParams.toString() ? `?${qsParams}` : "";
  const ctx: Ctx | null = a
    ? {
        a,
        prev: prevMonth && prev.data?.month === prevMonth ? prev.data : undefined,
        open: setDetail,
        setAgent: (x) => setQuery({ agente: x }),
        setMonth: (m) => setQuery({ mes: m }),
        setDias: (d) => setQuery({ dias: d }),
        desglosar: (titulo, clases, mes) => setDesglose({ titulo, clases, mes: mes ?? a.month! }),
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
            {a.month && <DiasPicker month={a.month} value={dias} hastaDatos={a.fechas.hasta} onChange={(x) => setQuery({ dias: x })} />}
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
          {current.slug === "comparativo" && <ComparativoTab {...ctx} />}
          {current.slug === "cumplimiento" && (
            <CumplimientoTab {...ctx} canEdit={me.data?.permissions.includes("config:editar") ?? false} refresh={() => void qc.invalidateQueries({ queryKey: ["analysis", code] })} />
          )}
        </div>
      )}

      {detail && a?.month && <ClientDetail campaign={code} month={a.month} agent={agent} spec={detail} onClose={closeDetail} />}
      {desglose && (
        <Desglose
          campaign={code}
          agent={agent}
          dias={dias}
          spec={desglose}
          onClose={() => setDesglose(null)}
          onClientes={
            desglose.mes === a?.month
              ? () => {
                  setDesglose(null);
                  setDetail({ fuente: "ventas", title: desglose.titulo, filters: desglose.clases ? { clase: desglose.clases } : undefined });
                }
              : undefined
          }
        />
      )}
    </>
  );
}
