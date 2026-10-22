/* Sistema de gráficas de la consola. Dirección: informe bien compuesto, no tablero.
   - Trazos finos: líneas de 2px, barras de 4–6px, columnas de máximo 16px con punta de 4px.
   - Cuadrícula de 1px casi invisible; los números van en tinta, nunca del color de la serie.
   - Cada valor es visible sin pasar el mouse; el tooltip solo agrega detalle.
   - Un solo color para una serie (azul Talk); estados del banco en verde · ámbar · rojo con etiqueta. */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

export const fmtInt = new Intl.NumberFormat("es-SV", { maximumFractionDigits: 0 });
export const fmtPct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`);
export const fmtNum = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("es-SV", { maximumFractionDigits: digits }).format(v);

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "2026-09-14" → "lun 14 sep" (sin desfase de zona horaria). */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  return `${DAYS[dt.getUTCDay()]} ${d} ${MONTHS_SHORT[(m ?? 1) - 1]}`;
}
export const monthShort = (ym: string) => `${MONTHS_SHORT[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    setW(Math.floor(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Ticks "redondos" para un eje que empieza en 0. */
function niceTicks(max: number, count = 3): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((s) => s * mag >= raw) ?? 10) * mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks.at(-1)! < max) ticks.push(ticks.at(-1)! + step);
  return ticks;
}
const compact = (v: number) => (v >= 1000 ? `${fmtNum(v / 1000, v >= 10000 ? 0 : 1)}k` : fmtInt.format(v));

/* ---------- tooltip ---------- */

interface Tip {
  x: number;
  y: number;
  content: ReactNode;
}
function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-xl bg-ink/95 px-3 py-2 text-xs whitespace-nowrap text-white shadow-[0_8px_24px_rgba(14,27,61,0.18)] dark:bg-slate-700"
      style={{ left: tip.x, top: tip.y - 12 }}
    >
      {tip.content}
    </div>
  );
}
export function TipRow({ color, label, value }: { color?: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 leading-5">
      {color && <span className="h-0.5 w-3 rounded-full" style={{ background: color }} aria-hidden />}
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-white/60">{label}</span>
    </div>
  );
}
const TipTitle = ({ children }: { children: ReactNode }) => <p className="mb-1 text-white/60 first-letter:uppercase">{children}</p>;

/* ---------- contenedores ---------- */

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[20px] border border-hair bg-white dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</div>;
}

export function ChartCard({ title, note, children, actions }: { title: string; note?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <Panel className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-ink dark:text-white">{title}</h3>
          {note && <p className="mt-1 text-[12.5px] text-ink-soft">{note}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Panel>
  );
}

/* ---------- franja de indicadores ---------- */

export interface Figure {
  label: string;
  value: string;
  foot?: ReactNode;
  tone?: "good" | "bad" | "warn";
  /** Curva mínima del mes (solo en el indicador principal). */
  spark?: number[];
}

function Spark({ values }: { values: number[] }) {
  const id = useId();
  if (values.length < 2) return null;
  const w = 120,
    h = 32;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  return (
    <svg width={w} height={h} className="mt-3 overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--viz-1)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--viz-1)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke="var(--viz-1)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r={2.5} fill="var(--viz-1)" />
    </svg>
  );
}

const TONE: Record<string, string> = {
  good: "text-[var(--st-good)]",
  bad: "text-[var(--st-critical)]",
  warn: "text-amber-600 dark:text-amber-400",
};

/** Indicadores en una sola franja separada por líneas finas. El primero es el protagonista. */
export function FigureStrip({ figures, children, actions }: { figures: Figure[]; children?: ReactNode; actions?: ReactNode }) {
  const [lead, ...rest] = figures;
  return (
    <Panel className="overflow-hidden">
      <div className="grid lg:grid-cols-[1.35fr_repeat(var(--n),1fr)]" style={{ ["--n" as string]: rest.length }}>
        {lead && (
          <div className="p-6 lg:pr-8">
            <div className="flex items-start justify-between gap-3">
              <p className="text-[13px] text-ink-soft">{lead.label}</p>
              {actions && <div className="shrink-0 whitespace-nowrap">{actions}</div>}
            </div>
            <p className={`mt-1 text-[44px] leading-none font-light tracking-[-0.03em] tabular-nums ${lead.tone ? TONE[lead.tone] : "text-ink dark:text-white"}`}>{lead.value}</p>
            {lead.foot && <p className="mt-2 text-[12.5px] text-ink-soft">{lead.foot}</p>}
            {lead.spark && <Spark values={lead.spark} />}
          </div>
        )}
        {rest.length > 0 && (
          <div className="grid grid-cols-2 border-t border-hair lg:contents dark:border-slate-800">
            {rest.map((f, i) => (
              <div key={f.label} className={`border-hair p-6 lg:border-t-0 lg:border-l dark:border-slate-800 ${i % 2 ? "border-l" : ""} ${i >= 2 ? "border-t" : ""}`}>
                <p className="text-[13px] text-ink-soft">{f.label}</p>
                <p className={`mt-1.5 text-[26px] leading-tight font-normal tracking-[-0.02em] tabular-nums ${f.tone ? TONE[f.tone] : "text-ink dark:text-white"}`}>{f.value}</p>
                {f.foot && <p className="mt-1 text-[12px] leading-snug text-ink-faint">{f.foot}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
      {children && <div className="border-t border-hair px-6 py-5 dark:border-slate-800">{children}</div>}
    </Panel>
  );
}

/* ---------- leyenda ---------- */

export function Legend({ items }: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[12.5px] text-ink-soft">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: it.color }} aria-hidden />
          {it.label}
          {it.value && <span className="text-ink tabular-nums dark:text-white">{it.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/* ---------- lista de barras ---------- */

/** Las etiquetas que vienen EN MAYÚSCULAS del banco se bajan a minúsculas (con mayúscula inicial por CSS);
    los nombres de personas y textos ya escritos con cuidado se dejan tal cual. */
const calmCase = (s: string) => (/[A-ZÁÉÍÓÚÑ]/.test(s) && s === s.toUpperCase() ? s.toLowerCase() : s);

export interface BarRow {
  label: string;
  value: number;
  color?: string;
  /** Cómo se muestra el valor (por defecto, el número entero). */
  display?: string;
  /** Texto a la derecha del valor (por defecto, el % del total). */
  note?: string;
}

export function BarList({ rows, max: maxRows = 10, total }: { rows: BarRow[]; max?: number; total?: number }) {
  const shown = rows.slice(0, maxRows);
  const rest = rows.slice(maxRows);
  const restSum = rest.reduce((s, r) => s + r.value, 0);
  const all = restSum ? [...shown, { label: `Otros (${rest.length})`, value: restSum, color: "var(--viz-axis)" }] : shown;
  const top = Math.max(...all.map((r) => r.value), 1);
  const sum = total ?? rows.reduce((s, r) => s + r.value, 0);
  if (!rows.length) return <p className="text-sm text-ink-soft">Sin datos.</p>;
  return (
    <ul className="space-y-4">
      {all.map((r) => {
        const share = sum ? (r.value / sum) * 100 : 0;
        return (
          <li key={r.label} title={`${r.label}: ${r.display ?? fmtInt.format(r.value)} (${r.note ?? fmtPct(share)})`}>
            <div className="mb-1.5 flex items-baseline justify-between gap-4 text-[13px]">
              <span className="truncate text-ink-soft first-letter:uppercase dark:text-slate-300">{calmCase(r.label)}</span>
              <span className="shrink-0 tabular-nums">
                <span className="font-medium text-ink dark:text-white">{r.display ?? fmtInt.format(r.value)}</span>
                <span className="ml-2 inline-block min-w-12 text-right text-ink-faint">{r.note ?? fmtPct(share)}</span>
              </span>
            </div>
            <div className="h-[5px] rounded-full bg-paper dark:bg-slate-800">
              <div className="h-full rounded-full" style={{ width: `${Math.max((r.value / top) * 100, r.value ? 1 : 0)}%`, background: r.color ?? "var(--viz-1)" }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- composición ---------- */

export function ShareBar({ parts, label }: { parts: { label: string; value: number; color: string }[]; label?: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div>
      <div className="flex h-2 w-full gap-[3px]" role="img" aria-label={label ?? parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {visible.map((p) => (
          <div
            key={p.label}
            className="h-full rounded-full"
            title={`${p.label}: ${fmtInt.format(p.value)} (${fmtPct((p.value / (total || 1)) * 100)})`}
            style={{ width: `${(p.value / (total || 1)) * 100}%`, background: p.color, minWidth: 4 }}
          />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
        {parts.map((p) => (
          <div key={p.label} className="flex items-start gap-2">
            <span className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
            <div className="leading-tight">
              <p className="text-[12.5px] text-ink-soft">{p.label}</p>
              <p className="mt-0.5 text-[15px] text-ink tabular-nums dark:text-white">
                {fmtInt.format(p.value)}
                <span className="ml-1.5 text-[12px] text-ink-faint">{fmtPct(total ? (p.value / total) * 100 : 0)}</span>
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- curva por día ---------- */

export interface Point {
  key: string;
  label: string;
  title: string;
  value: number;
  extra?: { label: string; value: string }[];
}

/** Curva suave (monótona) con velo; cruz de lectura que se ajusta al día más cercano. */
function smoothPath(pts: [number, number][]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0]![0]},${pts[0]![1]}` : "";
  const n = pts.length;
  const dx = pts.slice(1).map((p, i) => p[0] - pts[i]![0]);
  const m = pts.slice(1).map((p, i) => (p[1] - pts[i]![1]) / (dx[i] || 1));
  const t = pts.map((_, i) => (i === 0 ? m[0]! : i === n - 1 ? m[n - 2]! : m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2));
  let d = `M${pts[0]![0]},${pts[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3;
    d += ` C${pts[i]![0] + h},${pts[i]![1] + t[i]! * h} ${pts[i + 1]![0] - h},${pts[i + 1]![1] - t[i + 1]! * h} ${pts[i + 1]![0]},${pts[i + 1]![1]}`;
  }
  return d;
}

export function AreaChart({ data, height = 230, seriesLabel }: { data: Point[]; height?: number; seriesLabel: string }) {
  const id = useId();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 36,
    padR = 12,
    padT = 26,
    padB = 28;
  const values = data.map((d) => d.value);
  const ticks = niceTicks(Math.max(...values, 1));
  const yMax = ticks.at(-1)!;
  const plotW = Math.max(width - padL - padR, 10);
  const plotH = height - padT - padB;
  const x = (i: number) => padL + (data.length <= 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;
  const pts = data.map((d, i) => [x(i), y(d.value)] as [number, number]);
  const line = smoothPath(pts);
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44)));
  const maxIdx = values.indexOf(Math.max(...values));
  const h = hover !== null ? data[hover] : null;

  return (
    <div ref={ref} className="relative w-full" style={{ height }}>
      {width > 0 && data.length > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${seriesLabel} por día`}
          onPointerMove={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const px = e.clientX - r.left;
            const i = data.length <= 1 ? 0 : Math.round(((px - padL) / plotW) * (data.length - 1));
            setHover(Math.min(Math.max(i, 0), data.length - 1));
          }}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--viz-1)" stopOpacity="0.16" />
              <stop offset="1" stopColor="var(--viz-1)" stopOpacity="0" />
            </linearGradient>
          </defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} />
              <text x={padL - 10} y={y(t) + 3.5} textAnchor="end" fill="var(--viz-text)" fontSize={11} className="tabular-nums">
                {compact(t)}
              </text>
            </g>
          ))}
          <path d={`${line} L${pts.at(-1)![0]},${y(0)} L${pts[0]![0]},${y(0)} Z`} fill={`url(#${id})`} />
          <path d={line} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {data.map((d, i) =>
            i % labelEvery === 0 || i === data.length - 1 ? (
              <text key={d.key} x={x(i)} y={height - 8} textAnchor="middle" fill="var(--viz-text)" fontSize={11}>
                {d.label}
              </text>
            ) : null,
          )}
          {/* Etiqueta directa solo en el máximo */}
          {hover === null && maxIdx >= 0 && (
            <g>
              <circle cx={pts[maxIdx]![0]} cy={pts[maxIdx]![1]} r={4} fill="var(--viz-1)" stroke="var(--viz-surface)" strokeWidth={2} />
              <text x={pts[maxIdx]![0]} y={pts[maxIdx]![1] - 10} textAnchor="middle" fontSize={11} fontWeight={600} className="fill-ink dark:fill-white">
                {fmtInt.format(values[maxIdx]!)}
              </text>
            </g>
          )}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={y(0)} stroke="var(--viz-axis)" />
              <circle cx={pts[hover]![0]} cy={pts[hover]![1]} r={4.5} fill="var(--viz-1)" stroke="var(--viz-surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}
      {h && hover !== null && (
        <Tooltip
          tip={{
            x: Math.min(Math.max(x(hover), 70), width - 70),
            y: pts[hover]![1],
            content: (
              <div>
                <TipTitle>{h.title}</TipTitle>
                <TipRow color="var(--viz-1)" label={seriesLabel.toLowerCase()} value={fmtInt.format(h.value)} />
                {h.extra?.map((e) => <TipRow key={e.label} label={e.label} value={e.value} />)}
              </div>
            ),
          }}
        />
      )}
    </div>
  );
}

/* ---------- columnas (categorías o meses; apiladas si hay varias partes) ---------- */

export interface ColumnDatum {
  key: string;
  label: string;
  parts: { label: string; value: number; color: string }[];
  extra?: { label: string; value: string }[];
  title?: string;
}

export function Columns({ data, height = 220, legend }: { data: ColumnDatum[]; height?: number; legend?: boolean }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const padL = 36,
    padB = 28,
    padT = 18;
  const totals = data.map((d) => d.parts.reduce((s, p) => s + p.value, 0));
  const ticks = niceTicks(Math.max(...totals, 1));
  const yMax = ticks.at(-1)!;
  const plotW = Math.max(width - padL - 8, 10);
  const plotH = height - padB - padT;
  const slot = plotW / Math.max(data.length, 1);
  const barW = Math.min(16, Math.max(4, slot * 0.4));
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 40)));
  const seriesLegend = legend && data[0] ? data[0].parts.map((p) => ({ label: p.label, color: p.color })) : null;

  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Gráfica de columnas">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={width - 8} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} />
                <text x={padL - 10} y={y(t) + 3.5} textAnchor="end" fill="var(--viz-text)" fontSize={11} className="tabular-nums">
                  {compact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const cx = padL + slot * i + slot / 2;
              let acc = 0;
              const segs = d.parts.filter((p) => p.value > 0);
              return (
                <g key={d.key} opacity={hover && hover !== d.key ? 0.45 : 1} style={{ transition: "opacity 120ms" }}>
                  {segs.map((p, j) => {
                    const y0 = y(acc);
                    acc += p.value;
                    const y1 = y(acc);
                    const isTop = j === segs.length - 1;
                    const hgt = Math.max(y0 - y1 - (isTop ? 0 : 2), 0.5);
                    const x0 = cx - barW / 2;
                    const r = isTop ? Math.min(4, hgt, barW / 2) : 0;
                    const path = `M${x0},${y1 + hgt} L${x0},${y1 + r} Q${x0},${y1} ${x0 + r},${y1} L${x0 + barW - r},${y1} Q${x0 + barW},${y1} ${x0 + barW},${y1 + r} L${x0 + barW},${y1 + hgt} Z`;
                    return <path key={p.label} d={path} fill={p.color} />;
                  })}
                  {(i % labelEvery === 0 || data.length <= 12) && (
                    <text x={cx} y={height - 8} textAnchor="middle" fill="var(--viz-text)" fontSize={11}>
                      {d.label}
                    </text>
                  )}
                  {data.length <= 12 && totals[i]! > 0 && (
                    <text x={cx} y={y(totals[i]!) - 7} textAnchor="middle" fontSize={11} className="fill-ink-soft tabular-nums dark:fill-slate-300">
                      {compact(totals[i]!)}
                    </text>
                  )}
                  <rect
                    x={cx - slot / 2}
                    y={padT}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${d.title ?? d.label}: ${fmtInt.format(totals[i]!)}`}
                    onPointerMove={() => {
                      setHover(d.key);
                      setTip({
                        x: Math.min(Math.max(cx, 70), width - 70),
                        y: y(totals[i]!),
                        content: (
                          <div>
                            <TipTitle>{d.title ?? d.label}</TipTitle>
                            {d.parts.length > 1 && <TipRow label="total" value={fmtInt.format(totals[i]!)} />}
                            {[...d.parts].reverse().map((p) => (
                              <TipRow key={p.label} color={p.color} label={p.label.toLowerCase()} value={fmtInt.format(p.value)} />
                            ))}
                            {d.extra?.map((e) => <TipRow key={e.label} label={e.label} value={e.value} />)}
                          </div>
                        ),
                      });
                    }}
                    onFocus={() => setHover(d.key)}
                    onPointerLeave={() => {
                      setHover(null);
                      setTip(null);
                    }}
                    onBlur={() => setHover(null)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        <Tooltip tip={tip} />
      </div>
      {seriesLegend && seriesLegend.length > 1 && (
        <div className="mt-4">
          <Legend items={seriesLegend} />
        </div>
      )}
    </div>
  );
}

/* ---------- medidor ---------- */

/** Barra de avance. `mark` dibuja una marca fina en el valor esperado (por ejemplo, lo que tocaba a hoy). */
export function Meter({ value, max, label, thick, mark, markLabel }: { value: number; max: number; label?: string; thick?: boolean; mark?: number; markLabel?: string }) {
  const p = max ? Math.min(value / max, 1) : 0;
  const m = mark !== undefined && max ? Math.min(mark / max, 1) : null;
  const color = p >= 1 ? "var(--st-good)" : "var(--viz-1)";
  return (
    <div className="relative">
      <div className={`${thick ? "h-2" : "h-[5px]"} w-full rounded-full bg-paper dark:bg-slate-800`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <div className="h-full rounded-full" style={{ width: `${p * 100}%`, background: color }} />
      </div>
      {m !== null && (
        <span className="absolute -top-1.5 -bottom-1.5 w-0.5 -translate-x-1/2 rounded-full bg-ink dark:bg-white" style={{ left: `${m * 100}%` }} title={markLabel} aria-hidden />
      )}
    </div>
  );
}

/* ---------- tabla ---------- */

export interface Col<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  sort?: (row: T) => number | string;
}

export function DataTable<T>({ rows, cols, initialSort, empty = "Sin datos.", maxRows = 12 }: { rows: T[]; cols: Col<T>[]; initialSort?: string; empty?: string; maxRows?: number }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ? { key: initialSort, dir: -1 } : null);
  const [all, setAll] = useState(false);
  const col = cols.find((c) => c.key === sort?.key);
  const sorted = col?.sort
    ? [...rows].sort((a, b) => {
        const va = col.sort!(a),
          vb = col.sort!(b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * sort!.dir;
      })
    : rows;
  const visible = all ? sorted : sorted.slice(0, maxRows);
  if (!rows.length) return <p className="text-sm text-ink-soft">{empty}</p>;
  return (
    <div className="-mx-6 overflow-x-auto">
      <table className="w-full text-[13.5px]">
        <thead>
          <tr className="text-[12px] text-ink-faint">
            {cols.map((c) => (
              <th key={c.key} className={`px-6 pb-3 font-normal whitespace-nowrap ${c.align === "right" ? "text-right" : "text-left"}`}>
                {c.sort ? (
                  <button
                    className={`inline-flex items-center gap-1 transition-colors hover:text-ink dark:hover:text-white ${sort?.key === c.key ? "text-ink dark:text-white" : ""}`}
                    onClick={() => setSort((s) => ({ key: c.key, dir: s?.key === c.key && s.dir === -1 ? 1 : -1 }))}
                  >
                    {c.label}
                    {sort?.key === c.key && <span aria-hidden>{sort.dir === -1 ? "↓" : "↑"}</span>}
                  </button>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <tr key={i} className="border-t border-hair transition-colors hover:bg-paper/70 dark:border-slate-800 dark:hover:bg-slate-800/40">
              {cols.map((c, j) => (
                <td key={c.key} className={`px-6 py-3 whitespace-nowrap ${c.align === "right" ? "text-right tabular-nums" : ""} ${j === 0 ? "text-ink dark:text-white" : "text-ink/80 dark:text-slate-300"}`}>
                  {c.render(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length > maxRows && (
        <div className="border-t border-hair px-6 pt-4 dark:border-slate-800">
          <button onClick={() => setAll((v) => !v)} className="text-[13px] font-medium text-brand-600 hover:underline">
            {all ? "Ver menos" : `Ver las ${sorted.length} filas`}
          </button>
        </div>
      )}
    </div>
  );
}

/** Número con una barra mínima detrás, para columnas de porcentaje. */
export function PctCell({ value, max = 100, digits = 1 }: { value: number; max?: number; digits?: number }) {
  return (
    <span className="inline-flex items-center justify-end gap-3">
      <span className="hidden h-[3px] w-16 rounded-full bg-paper sm:inline-block dark:bg-slate-800">
        <span className="block h-full rounded-full bg-[var(--viz-1)]" style={{ width: `${Math.min((value / max) * 100, 100)}%` }} />
      </span>
      <span className="w-14 tabular-nums">{fmtPct(value, digits)}</span>
    </span>
  );
}
