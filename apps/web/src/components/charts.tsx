/* Sistema de gráficas de la consola. Dirección: informe bien compuesto que se puede explorar.
   - Trazos finos: líneas de 2px, barras de 5px, columnas de máximo 16px con punta de 4px.
   - Cuadrícula de 1px casi invisible; los números van en tinta, nunca del color de la serie.
   - Cada valor es visible sin pasar el mouse; el cursor agrega detalle y el clic abre los clientes.
   - Un solo color para una serie (azul Talk); estados del banco en verde, ámbar y rojo, con etiqueta.
   - Movimiento solo para mostrar qué cambió (al abrir o cambiar de mes) y nunca con "reducir movimiento". */
import { ChevronRight } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export const fmtInt = new Intl.NumberFormat("es-SV", { maximumFractionDigits: 0 });
export const fmtPct = (v: number | null | undefined, digits = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(digits)}%`);
export const fmtNum = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined || !Number.isFinite(v) ? "—" : new Intl.NumberFormat("es-SV", { maximumFractionDigits: digits }).format(v);
export const intOf = (n: number) => fmtInt.format(Math.round(n));

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** "2026-09-14" → "lun 14 sep" (sin desfase de zona horaria). */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  return `${DAYS[dt.getUTCDay()]} ${d} ${MONTHS_SHORT[(m ?? 1) - 1]}`;
}
export const monthShort = (ym: string) => `${MONTHS_SHORT[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

/* ---------- utilidades ---------- */

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

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Número que cuenta desde su valor anterior hasta el nuevo (al abrir, al cambiar de mes o de agente). */
export function useCountUp(target: number, duration = 750): number {
  const [shown, setShown] = useState(prefersReducedMotion() ? target : 0);
  const from = useRef(shown);
  useEffect(() => {
    if (prefersReducedMotion() || !Number.isFinite(target)) {
      setShown(target);
      from.current = target;
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1);
      const e = 1 - Math.pow(1 - t, 3);
      const v = a + (target - a) * e;
      setShown(v);
      from.current = v;
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);
  return shown;
}

export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
  const v = useCountUp(value);
  return <>{format(v)}</>;
}

/** Animación de entrada solo durante `ms` tras cambiar `sig`. Después se quita la clase, para que un
    cambio de tamaño (abrir el panel, girar el celular) no vuelva a dibujar las gráficas SVG. */
function useIntro(sig: string, ms = 1500): boolean {
  const [on, setOn] = useState(!prefersReducedMotion());
  useEffect(() => {
    if (prefersReducedMotion()) return;
    setOn(true);
    const t = setTimeout(() => setOn(false), ms);
    return () => clearTimeout(t);
  }, [sig, ms]);
  return on;
}

/** Firma corta de una serie: cambia cuando cambian los datos, para volver a animar solo entonces. */
const signature = (vals: number[]) => `${vals.length}:${vals.reduce((s, v, i) => s + v * (i + 1), 0)}`;

/** Ticks "redondos" para un eje que empieza en 0. */
function niceTicks(max: number, count = 3): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  // Pasos enteros: los ejes cuentan ventas, llamadas o clientes.
  const step = Math.max(1, ([1, 2, 2.5, 5, 10].find((s) => s * mag >= raw && Number.isInteger(s * mag)) ?? 10) * mag);
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
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-xl bg-[#0e1b3d]/95 px-3 py-2 text-xs whitespace-nowrap text-white shadow-[0_8px_24px_rgba(14,27,61,0.18)] dark:bg-slate-700"
      style={{ left: tip.x, top: tip.y - 12 }}
    >
      {tip.content}
    </div>
  );
}
export function TipRow({ color, dashed, label, value }: { color?: string; dashed?: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 leading-5">
      {color && <span className={`w-3 ${dashed ? "border-t border-dashed" : "h-0.5 rounded-full"}`} style={dashed ? { borderColor: color } : { background: color }} aria-hidden />}
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="text-white/60">{label}</span>
    </div>
  );
}
const TipTitle = ({ children }: { children: ReactNode }) => <p className="mb-1 text-white/60 first-letter:uppercase">{children}</p>;
const TipHint = ({ children }: { children: ReactNode }) => <p className="mt-1.5 border-t border-white/10 pt-1.5 text-[11px] text-white/50">{children}</p>;

/* ---------- contenedores ---------- */

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[20px] border border-hair bg-white dark:bg-slate-900 ${className}`}>{children}</div>;
}

export function ChartCard({ title, note, children, actions }: { title: string; note?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <Panel className="p-6 sm:p-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h3 className="text-[16px] font-semibold text-ink">{title}</h3>
          {note && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">{note}</p>}
        </div>
        {actions}
      </div>
      {children}
    </Panel>
  );
}

/* ---------- comparación contra el mes anterior ---------- */

export interface Delta {
  /** Texto ya formateado: "+8.2%", "−1.3 pts". */
  text: string;
  dir: "up" | "down" | "flat";
  /** true = el cambio es bueno, false = malo, null = neutral. */
  good: boolean | null;
  /** "vs agosto". */
  against: string;
}

/** Cambio de un conteo (en %) o de una tasa (en puntos), con su lectura de bueno o malo. */
export function deltaOf(now: number | null | undefined, before: number | null | undefined, against: string, opts: { rate?: boolean; upIsGood?: boolean | null } = {}): Delta | undefined {
  if (now === null || now === undefined || before === null || before === undefined || !Number.isFinite(now) || !Number.isFinite(before)) return undefined;
  const upIsGood = opts.upIsGood === undefined ? true : opts.upIsGood;
  const diff = opts.rate ? now - before : before ? ((now - before) / before) * 100 : null;
  if (diff === null) return undefined;
  const dir = Math.abs(diff) < 0.05 ? "flat" : diff > 0 ? "up" : "down";
  // La flecha ya dice si subió o bajó: el número va sin signo.
  const text = opts.rate ? `${fmtNum(Math.abs(diff), 1)} pts` : `${fmtNum(Math.abs(diff), 1)}%`;
  return { text, dir, good: dir === "flat" || upIsGood === null ? null : (dir === "up") === upIsGood, against };
}

export function DeltaBadge({ d }: { d: Delta }) {
  const tone = d.good === null ? "text-ink-soft" : d.good ? "text-[var(--st-good)]" : "text-[var(--st-critical)]";
  return (
    <span className="inline-flex items-center gap-1 text-[12px] whitespace-nowrap tabular-nums" title={`${d.dir === "up" ? "Subió" : d.dir === "down" ? "Bajó" : "Igual"} ${d.text} ${d.against}`}>
      <span className={tone}>
        <span aria-hidden>{d.dir === "up" ? "↑" : d.dir === "down" ? "↓" : "="}</span> {d.text}
      </span>
      <span className="text-ink-faint">{d.against}</span>
    </span>
  );
}

/* ---------- franja de indicadores ---------- */

export interface Figure {
  label: string;
  /** Valor ya formateado (para textos como "—"). */
  value?: string;
  /** Valor numérico: se anima al cambiar. */
  num?: number;
  format?: (n: number) => string;
  foot?: ReactNode;
  tone?: "good" | "bad" | "warn";
  delta?: Delta;
  /** Curva mínima del mes (solo en el indicador principal). */
  spark?: number[];
  /** Abre los clientes detrás de la cifra. */
  onOpen?: () => void;
}

function Spark({ values }: { values: number[] }) {
  const id = useId();
  const intro = useIntro(signature(values));
  if (values.length < 2) return null;
  const w = 132,
    h = 34;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - (v / max) * (h - 6)] as [number, number]);
  const line = monotonePath(pts);
  return (
    <svg width={w} height={h} className="mt-4 overflow-visible" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--viz-1)" stopOpacity="0.18" />
          <stop offset="1" stopColor="var(--viz-1)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className={intro ? "viz-fade" : undefined} d={`${line} L${w},${h} L0,${h} Z`} fill={`url(#${id})`} />
      <path className={intro ? "viz-draw" : undefined} pathLength={1} d={line} fill="none" stroke="var(--viz-1)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle className={intro ? "viz-fade" : undefined} cx={pts.at(-1)![0]} cy={pts.at(-1)![1]} r={2.5} fill="var(--viz-1)" />
    </svg>
  );
}

const TONE: Record<string, string> = {
  good: "text-[var(--st-good)]",
  bad: "text-[var(--st-critical)]",
  warn: "text-amber-600 dark:text-amber-400",
};

function FigureValue({ f, lead }: { f: Figure; lead?: boolean }) {
  const cls = lead ? "mt-2 text-[52px] leading-none font-light tracking-[-0.03em]" : "mt-2 text-[30px] leading-tight font-normal tracking-[-0.02em]";
  return (
    <span className={`block ${cls} tabular-nums ${f.tone ? TONE[f.tone] : "text-ink"}`}>
      {f.num !== undefined && f.format ? <CountUp value={f.num} format={f.format} /> : (f.value ?? "—")}
    </span>
  );
}

/** Celda de la franja; si tiene `onOpen` es un botón que abre los clientes. */
function FigureCell({ f, className, children }: { f: Figure; className: string; children: ReactNode }) {
  if (!f.onOpen) return <div className={className}>{children}</div>;
  return (
    <button type="button" onClick={f.onOpen} className={`group relative flex flex-col items-stretch justify-start text-left transition-colors hover:bg-paper/60 focus-visible:bg-paper/60 dark:hover:bg-slate-800/40 ${className}`}>
      {children}
      <span className="pointer-events-none absolute right-5 bottom-4 inline-flex items-center gap-0.5 text-[12px] text-brand-600 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        Ver clientes <ChevronRight className="size-3.5" aria-hidden />
      </span>
    </button>
  );
}

/** Indicadores en una sola franja separada por líneas finas. El primero es el protagonista. */
export function FigureStrip({ figures, children, actions }: { figures: Figure[]; children?: ReactNode; actions?: ReactNode }) {
  const [lead, ...rest] = figures;
  return (
    <Panel className="overflow-hidden">
      <div className="grid lg:grid-cols-[1.5fr_repeat(var(--n),1fr)]" style={{ ["--n" as string]: rest.length }}>
        {lead && (
          <FigureCell f={lead} className="p-7 lg:p-8">
            <span className="flex items-start justify-between gap-3">
              <span className="block text-[13.5px] text-ink-soft">{lead.label}</span>
              {actions && <span className="shrink-0 whitespace-nowrap">{actions}</span>}
            </span>
            <FigureValue f={lead} lead />
            {lead.foot && <span className="mt-3 block text-[13px] leading-relaxed text-ink-soft">{lead.foot}</span>}
            {lead.delta && (
              <span className="mt-2.5 block">
                <DeltaBadge d={lead.delta} />
              </span>
            )}
            {lead.spark && <Spark values={lead.spark} />}
          </FigureCell>
        )}
        {rest.length > 0 && (
          <div className="grid grid-cols-2 border-t border-hair lg:contents">
            {rest.map((f, i) => (
              <FigureCell key={f.label} f={f} className={`border-hair p-7 lg:border-t-0 lg:border-l lg:px-7 lg:py-8 ${i % 2 ? "border-l" : ""} ${i >= 2 ? "border-t" : ""}`}>
                <span className="block text-[13.5px] text-ink-soft">{f.label}</span>
                <FigureValue f={f} />
                {f.foot && <span className="mt-2 block text-[12.5px] leading-relaxed text-ink-faint">{f.foot}</span>}
                {f.delta && (
                  <span className="mt-2.5 block">
                    <DeltaBadge d={f.delta} />
                  </span>
                )}
              </FigureCell>
            ))}
          </div>
        )}
      </div>
      {children && <div className="border-t border-hair px-7 py-7 lg:px-8">{children}</div>}
    </Panel>
  );
}

/* ---------- leyenda (se puede usar para encender y apagar series) ---------- */

export function Legend({ items, hidden, onToggle }: { items: { label: string; color: string; value?: string; dashed?: boolean }[]; hidden?: Set<string>; onToggle?: (label: string) => void }) {
  return (
    <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[13px] text-ink-soft">
      {items.map((it) => {
        const off = hidden?.has(it.label);
        const swatch = it.dashed ? (
          <span className="w-3 border-t-[1.5px] border-dashed" style={{ borderColor: it.color }} aria-hidden />
        ) : (
          <span className="size-2 rounded-full transition-opacity" style={{ background: it.color, opacity: off ? 0.25 : 1 }} aria-hidden />
        );
        const content = (
          <>
            {swatch}
            <span className={off ? "line-through decoration-ink-faint" : ""}>{it.label}</span>
            {it.value && <span className="text-ink tabular-nums">{it.value}</span>}
          </>
        );
        return (
          <li key={it.label}>
            {onToggle ? (
              <button type="button" aria-pressed={!off} onClick={() => onToggle(it.label)} className="flex items-center gap-2 rounded-md transition-colors hover:text-ink" title={off ? "Mostrar" : "Ocultar"}>
                {content}
              </button>
            ) : (
              <span className="flex items-center gap-2">{content}</span>
            )}
          </li>
        );
      })}
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

export function BarList({
  rows,
  max: maxRows = 10,
  total,
  onSelect,
  selectHint = "Ver clientes",
  active,
}: {
  rows: BarRow[];
  max?: number;
  total?: number;
  onSelect?: (row: BarRow) => void;
  selectHint?: string;
  /** Etiqueta resaltada (por ejemplo, el agente filtrado). */
  active?: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const limit = expanded ? rows.length : maxRows;
  const shown = rows.slice(0, limit);
  const rest = rows.slice(limit);
  const restSum = rest.reduce((s, r) => s + r.value, 0);
  const top = Math.max(...rows.map((r) => r.value), restSum, 1);
  const sum = total ?? rows.reduce((s, r) => s + r.value, 0);
  if (!rows.length) return <p className="text-sm text-ink-soft">Sin datos.</p>;

  const line = (r: BarRow, i: number, clickable: boolean) => {
    const share = sum ? (r.value / sum) * 100 : 0;
    const dim = active && r.label !== active;
    return (
      <>
        <div className="mb-2 flex items-baseline justify-between gap-6 text-[13.5px]">
          <span className={`flex min-w-0 items-center gap-1 truncate first-letter:uppercase ${dim ? "text-ink-faint" : "text-ink-soft"} ${clickable ? "group-hover:text-ink" : ""}`}>
            <span className="truncate first-letter:uppercase">{calmCase(r.label)}</span>
            {clickable && <ChevronRight className="size-3.5 shrink-0 -translate-x-1 text-brand-600 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />}
          </span>
          <span className="shrink-0 tabular-nums">
            <span className={`font-medium ${dim ? "text-ink-soft" : "text-ink"}`}>{r.display ?? fmtInt.format(r.value)}</span>
            <span className="ml-3 inline-block min-w-14 text-right text-ink-faint">{r.note ?? fmtPct(share)}</span>
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-paper dark:bg-slate-800">
          <div
            className="viz-grow-x h-full rounded-full transition-[width,opacity] duration-500"
            style={{ width: `${Math.max((r.value / top) * 100, r.value ? 1 : 0)}%`, background: r.color ?? "var(--viz-1)", opacity: dim ? 0.3 : 1, animationDelay: `${i * 35}ms` }}
          />
        </div>
      </>
    );
  };

  return (
    <div>
      <ul className="space-y-4">
        {shown.map((r, i) => (
          <li key={r.label}>
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(r)}
                title={`${selectHint}: ${r.label}`}
                className="group -mx-3 block w-[calc(100%+1.5rem)] rounded-xl px-3 py-1.5 text-left transition-colors hover:bg-paper/70 dark:hover:bg-slate-800/40"
              >
                {line(r, i, true)}
              </button>
            ) : (
              <div className="py-1.5" title={`${r.label}: ${r.display ?? fmtInt.format(r.value)}`}>
                {line(r, i, false)}
              </div>
            )}
          </li>
        ))}
        {restSum > 0 && (
          <li className="py-1.5">{line({ label: `Otros (${rest.length})`, value: restSum, color: "var(--viz-axis)" }, shown.length, false)}</li>
        )}
      </ul>
      {rows.length > maxRows && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-5 text-[13px] font-medium text-brand-600 hover:underline">
          {expanded ? "Ver menos" : `Ver los ${rows.length}`}
        </button>
      )}
    </div>
  );
}

/* ---------- composición ---------- */

export interface Part {
  label: string;
  value: number;
  color: string;
}

export function ShareBar({ parts, label, onSelect }: { parts: Part[]; label?: string; onSelect?: (p: Part) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const total = parts.reduce((s, p) => s + p.value, 0);
  const visible = parts.filter((p) => p.value > 0);
  return (
    <div onPointerLeave={() => setHover(null)}>
      <div className="flex h-2.5 w-full gap-[3px]" role={onSelect ? "group" : "img"} aria-label={label ?? parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
        {visible.map((p, i) => {
          const common = {
            onPointerEnter: () => setHover(p.label),
            title: `${p.label}: ${fmtInt.format(p.value)} (${fmtPct((p.value / (total || 1)) * 100)})`,
            style: { width: `${(p.value / (total || 1)) * 100}%`, background: p.color, minWidth: 4, opacity: hover && hover !== p.label ? 0.3 : 1, animationDelay: `${i * 60}ms` },
          };
          return onSelect ? (
            <button key={p.label} type="button" onClick={() => onSelect(p)} aria-label={`${p.label}: ${fmtInt.format(p.value)}. Ver clientes`} className="viz-grow-x h-full cursor-pointer rounded-full transition-opacity duration-200" {...common} />
          ) : (
            <div key={p.label} className="viz-grow-x h-full rounded-full transition-opacity duration-200" {...common} />
          );
        })}
      </div>
      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
        {parts.map((p) => {
          const inner = (
            <>
              <span className="mt-[7px] size-2 shrink-0 rounded-full" style={{ background: p.color }} aria-hidden />
              <span className="block leading-tight">
                <span className={`block text-[13px] transition-colors ${hover === p.label ? "text-ink" : "text-ink-soft"}`}>{p.label}</span>
                <span className="mt-1 block text-[17px] text-ink tabular-nums">
                  <CountUp value={p.value} format={intOf} />
                  <span className="ml-2 text-[12.5px] text-ink-faint">{fmtPct(total ? (p.value / total) * 100 : 0)}</span>
                </span>
              </span>
            </>
          );
          return onSelect ? (
            <button
              key={p.label}
              type="button"
              onClick={() => onSelect(p)}
              onPointerEnter={() => setHover(p.label)}
              onFocus={() => setHover(p.label)}
              onBlur={() => setHover(null)}
              className="-m-1.5 flex items-start gap-2 rounded-lg p-1.5 text-left transition-colors hover:bg-paper/70 dark:hover:bg-slate-800/40"
            >
              {inner}
            </button>
          ) : (
            <div key={p.label} className="flex items-start gap-2" onPointerEnter={() => setHover(p.label)}>
              {inner}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- curva por día ---------- */

export interface Point {
  /** Fecha ISO del día. */
  key: string;
  /** Día del mes (eje horizontal). */
  day: number;
  label: string;
  title: string;
  value: number;
  extra?: { label: string; value: string }[];
}

/** Curva cúbica monótona (Fritsch–Carlson): pasa por cada punto sin inventar picos ni valles. */
function monotonePath(pts: [number, number][]): string {
  const n = pts.length;
  if (n < 2) return n ? `M${pts[0]![0]},${pts[0]![1]}` : "";
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(pts[i + 1]![0] - pts[i]![0]);
    m.push((pts[i + 1]![1] - pts[i]![1]) / (dx[i] || 1));
  }
  const t: number[] = [m[0]!];
  for (let i = 1; i < n - 1; i++) t.push(m[i - 1]! * m[i]! <= 0 ? 0 : (m[i - 1]! + m[i]!) / 2);
  t.push(m[n - 2]!);
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i]! / m[i]!;
    const b = t[i + 1]! / m[i]!;
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i]!;
      t[i + 1] = k * b * m[i]!;
    }
  }
  let d = `M${pts[0]![0].toFixed(1)},${pts[0]![1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]! / 3;
    d += ` C${(pts[i]![0] + h).toFixed(1)},${(pts[i]![1] + t[i]! * h).toFixed(1)} ${(pts[i + 1]![0] - h).toFixed(1)},${(pts[i + 1]![1] - t[i + 1]! * h).toFixed(1)} ${pts[i + 1]![0].toFixed(1)},${pts[i + 1]![1].toFixed(1)}`;
  }
  return d;
}

export interface Compare {
  /** "agosto". */
  label: string;
  /** Valor por día del mes. */
  byDay: Record<number, number>;
}

/**
 * Serie diaria: curva suave con velo, el mes anterior como línea punteada de referencia,
 * lectura con el cursor o el teclado, clic en un día para ver sus clientes y arrastre para
 * seleccionar un rango de días con su resumen.
 */
export function AreaChart({
  data,
  height = 300,
  seriesLabel,
  unit,
  compare,
  onOpenDay,
  onOpenRange,
}: {
  data: Point[];
  height?: number;
  seriesLabel: string;
  /** Palabra para el resumen ("ventas", "llamadas"). */
  unit?: string;
  compare?: Compare;
  onOpenDay?: (p: Point) => void;
  onOpenRange?: (from: Point, to: Point) => void;
}) {
  const id = useId();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number; moved: boolean } | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const word = unit ?? seriesLabel.toLowerCase();

  // Al cambiar los datos (otro mes u otro agente) se quita la selección.
  const sig = signature(data.map((d) => d.value));
  const intro = useIntro(sig);
  useEffect(() => {
    setRange(null);
    setHover(null);
  }, [sig]);

  const padL = 42,
    padR = 12,
    padT = 26,
    padB = 34;
  const values = data.map((d) => d.value);
  const cmpVals = compare ? Object.values(compare.byDay) : [];
  const ticks = niceTicks(Math.max(...values, ...cmpVals, 1));
  const yMax = ticks.at(-1)!;
  const plotW = Math.max(width - padL - padR, 10);
  const plotH = height - padT - padB;
  const d0 = data[0]?.day ?? 1;
  const d1 = Math.max(data.at(-1)?.day ?? d0, d0 + 1);
  const x = (day: number) => padL + ((day - d0) / (d1 - d0)) * plotW;
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;
  const pts = data.map((d) => [x(d.day), y(d.value)] as [number, number]);
  const line = monotonePath(pts);
  const cmpPts = compare
    ? Object.entries(compare.byDay)
        .map(([k, v]) => [Number(k), v] as const)
        .filter(([k]) => k >= d0 && k <= d1)
        .sort((a, b) => a[0] - b[0])
        .map(([k, v]) => [x(k), y(v)] as [number, number])
    : [];
  const cmpLine = cmpPts.length > 1 ? monotonePath(cmpPts) : "";
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 44)));
  const maxIdx = values.indexOf(Math.max(...values));

  const indexAt = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const day = d0 + ((clientX - r.left - padL) / plotW) * (d1 - d0);
    let best = 0;
    for (let i = 1; i < data.length; i++) if (Math.abs(data[i]!.day - day) < Math.abs(data[best]!.day - day)) best = i;
    return best;
  };

  const sel: [number, number] | null = drag && drag.moved ? [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)] : range;
  const summary = useMemo(() => {
    if (!range) return null;
    const part = data.slice(range[0], range[1] + 1);
    const sum = part.reduce((s, p) => s + p.value, 0);
    const best = part.reduce((b, p) => (p.value > b.value ? p : b), part[0]!);
    return { from: data[range[0]]!, to: data[range[1]]!, sum, avg: sum / part.length, best, days: part.length };
  }, [range, data]);

  const onKey = (e: KeyboardEvent) => {
    if (!data.length) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const cur = hover ?? (e.key === "ArrowRight" ? -1 : data.length);
      setHover(Math.min(Math.max(cur + (e.key === "ArrowRight" ? 1 : -1), 0), data.length - 1));
    } else if (e.key === "Home") setHover(0);
    else if (e.key === "End") setHover(data.length - 1);
    else if (e.key === "Enter" && hover !== null && onOpenDay) onOpenDay(data[hover]!);
    else if (e.key === "Escape") {
      setRange(null);
      setHover(null);
    }
  };

  const h = hover !== null ? data[hover] : null;
  const cmpAtHover = h && compare ? compare.byDay[h.day] : undefined;

  return (
    <div>
      <div ref={ref} className="relative w-full select-none" style={{ height }}>
        {width > 0 && data.length > 0 && (
          <svg
            ref={svgRef}
            width={width}
            height={height}
            role="img"
            tabIndex={0}
            aria-label={`${seriesLabel} por día. Flechas para recorrer los días${onOpenDay ? ", Enter para ver los clientes del día" : ""}.`}
            className={`outline-none ${onOpenDay ? "cursor-crosshair" : ""}`}
            onKeyDown={onKey}
            onBlur={() => setHover(null)}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
              const i = indexAt(e.clientX);
              setDrag({ a: i, b: i, moved: false });
            }}
            onPointerMove={(e) => {
              const i = indexAt(e.clientX);
              setHover(i);
              if (drag && i !== drag.b) setDrag({ ...drag, b: i, moved: drag.moved || i !== drag.a });
            }}
            onPointerUp={() => {
              if (!drag) return;
              if (drag.moved && drag.a !== drag.b) setRange([Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)]);
              else if (onOpenDay) onOpenDay(data[drag.a]!);
              setDrag(null);
            }}
            onPointerLeave={(e) => {
              if (e.buttons === 0) setHover(null);
            }}
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
                <text x={padL - 10} y={y(t) + 3.5} textAnchor="end" fill="var(--viz-text)" fontSize={12} className="tabular-nums">
                  {compact(t)}
                </text>
              </g>
            ))}
            {sel && (
              <rect
                x={x(data[sel[0]]!.day) - 4}
                y={padT - 8}
                width={x(data[sel[1]]!.day) - x(data[sel[0]]!.day) + 8}
                height={plotH + 8}
                rx={6}
                fill="var(--viz-1)"
                opacity={0.07}
              />
            )}
            <g key={sig}>
              <path className={intro ? "viz-fade" : undefined} d={`${line} L${pts.at(-1)![0]},${y(0)} L${pts[0]![0]},${y(0)} Z`} fill={`url(#${id})`} />
              {cmpLine && <path className={intro ? "viz-fade" : undefined} d={cmpLine} fill="none" stroke="var(--viz-text)" strokeWidth={1.5} strokeDasharray="3 4" strokeLinecap="round" opacity={0.8} />}
              <path className={intro ? "viz-draw" : undefined} pathLength={1} d={line} fill="none" stroke="var(--viz-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            </g>
            {data.map((d, i) =>
              i % labelEvery === 0 || i === data.length - 1 ? (
                <text key={d.key} x={x(d.day)} y={height - 8} textAnchor="middle" fill="var(--viz-text)" fontSize={12}>
                  {d.label}
                </text>
              ) : null,
            )}
            {hover === null && !sel && maxIdx >= 0 && (
              <g className={intro ? "viz-fade" : undefined} style={{ animationDelay: "600ms" }}>
                <circle cx={pts[maxIdx]![0]} cy={pts[maxIdx]![1]} r={4} fill="var(--viz-1)" stroke="var(--viz-surface)" strokeWidth={2} />
                <text x={pts[maxIdx]![0]} y={pts[maxIdx]![1] - 10} textAnchor="middle" fontSize={12} fontWeight={600} className="fill-ink">
                  {fmtInt.format(values[maxIdx]!)}
                </text>
              </g>
            )}
            {hover !== null && (
              <g pointerEvents="none">
                <line x1={x(data[hover]!.day)} x2={x(data[hover]!.day)} y1={padT - 6} y2={y(0)} stroke="var(--viz-axis)" />
                {cmpAtHover !== undefined && <circle cx={x(data[hover]!.day)} cy={y(cmpAtHover)} r={3} fill="var(--viz-surface)" stroke="var(--viz-text)" strokeWidth={1.5} />}
                <circle cx={pts[hover]![0]} cy={pts[hover]![1]} r={4.5} fill="var(--viz-1)" stroke="var(--viz-surface)" strokeWidth={2} />
              </g>
            )}
          </svg>
        )}
        {h && hover !== null && (
          <Tooltip
            tip={{
              x: Math.min(Math.max(x(h.day), 80), width - 80),
              y: Math.min(pts[hover]![1], cmpAtHover !== undefined ? y(cmpAtHover) : Infinity),
              content: (
                <div>
                  <TipTitle>{h.title}</TipTitle>
                  <TipRow color="var(--viz-1)" label={word} value={fmtInt.format(h.value)} />
                  {h.extra?.map((e) => <TipRow key={e.label} label={e.label} value={e.value} />)}
                  {cmpAtHover !== undefined && <TipRow color="var(--viz-text)" dashed label={`${word} en ${compare!.label}`} value={fmtInt.format(cmpAtHover)} />}
                  {onOpenDay && !drag && <TipHint>Clic para ver los clientes, arrastra para elegir varios días</TipHint>}
                </div>
              ),
            }}
          />
        )}
      </div>

      <div className="mt-5 flex min-h-8 flex-wrap items-center justify-between gap-4">
        {summary ? (
          <div className="fade-in flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-paper px-3.5 py-2 text-[12.5px] text-ink-soft dark:bg-slate-800/60">
            <span>
              Del <span className="text-ink">{summary.from.title}</span> al <span className="text-ink">{summary.to.title}</span>:
            </span>
            <span>
              <span className="font-medium text-ink tabular-nums">{fmtInt.format(summary.sum)}</span> {word}
            </span>
            <span>
              <span className="font-medium text-ink tabular-nums">{fmtNum(summary.avg)}</span> por día
            </span>
            <span>
              mejor día {summary.best.title} con <span className="font-medium text-ink tabular-nums">{fmtInt.format(summary.best.value)}</span>
            </span>
            {onOpenRange && (
              <button type="button" onClick={() => onOpenRange(summary.from, summary.to)} className="font-medium text-brand-600 hover:underline">
                Ver clientes
              </button>
            )}
            <button type="button" onClick={() => setRange(null)} className="text-ink-faint hover:text-ink">
              Quitar selección
            </button>
          </div>
        ) : (
          <span />
        )}
        {compare && cmpPts.length > 1 && (
          <Legend
            items={[
              { label: seriesLabel, color: "var(--viz-1)" },
              { label: `Mes anterior (${compare.label})`, color: "var(--viz-text)", dashed: true },
            ]}
          />
        )}
      </div>
    </div>
  );
}

/* ---------- columnas (categorías o meses; apiladas si hay varias partes) ---------- */

export interface ColumnDatum {
  key: string;
  label: string;
  parts: Part[];
  extra?: { label: string; value: string }[];
  title?: string;
}

export function Columns({
  data,
  height = 270,
  legend,
  onSelect,
  selectHint,
  active,
}: {
  data: ColumnDatum[];
  height?: number;
  legend?: boolean;
  onSelect?: (d: ColumnDatum) => void;
  selectHint?: string;
  /** Columna resaltada (por ejemplo, el mes elegido). */
  active?: string | null;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [tip, setTip] = useState<Tip | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const intro = useIntro(signature(data.map((d) => d.parts.reduce((s, p) => s + p.value, 0))));
  const padL = 42,
    padB = 34,
    padT = 18;
  const view = data.map((d) => ({ ...d, parts: d.parts.filter((p) => !hidden.has(p.label)) }));
  const totals = view.map((d) => d.parts.reduce((s, p) => s + p.value, 0));
  const ticks = niceTicks(Math.max(...totals, 1));
  const yMax = ticks.at(-1)!;
  const plotW = Math.max(width - padL - 8, 10);
  const plotH = height - padB - padT;
  const slot = plotW / Math.max(data.length, 1);
  const barW = Math.min(16, Math.max(4, slot * 0.4));
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(plotW / 40)));
  const series = data[0] ? data[0].parts.map((p) => ({ label: p.label, color: p.color })) : [];
  const toggle = (label: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(label)) n.delete(label);
      else if (series.length - n.size > 1) n.add(label); // siempre queda al menos una serie
      return n;
    });

  return (
    <div>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <svg width={width} height={height} role="img" aria-label="Gráfica de columnas">
            {ticks.map((t) => (
              <g key={t}>
                <line x1={padL} x2={width - 8} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-axis)" : "var(--viz-grid)"} />
                <text x={padL - 10} y={y(t) + 3.5} textAnchor="end" fill="var(--viz-text)" fontSize={12} className="tabular-nums">
                  {compact(t)}
                </text>
              </g>
            ))}
            {view.map((d, i) => {
              const cx = padL + slot * i + slot / 2;
              let acc = 0;
              const segs = d.parts.filter((p) => p.value > 0);
              const dim = (hover && hover !== d.key) || (active && active !== d.key && !hover);
              return (
                <g key={d.key} opacity={dim ? 0.4 : 1} style={{ transition: "opacity 160ms" }}>
                  <g className={intro ? "viz-grow-y" : undefined} style={{ animationDelay: `${i * 40}ms` }}>
                    {segs.map((p, j) => {
                      const y0 = y(acc);
                      acc += p.value;
                      const y1 = y(acc);
                      const isTop = j === segs.length - 1;
                      const hgt = Math.max(y0 - y1 - (isTop ? 0 : 2), 0.5);
                      const x0 = cx - barW / 2;
                      const r = isTop ? Math.min(4, hgt, barW / 2) : 0;
                      const path = `M${x0},${y1 + hgt} L${x0},${y1 + r} Q${x0},${y1} ${x0 + r},${y1} L${x0 + barW - r},${y1} Q${x0 + barW},${y1} ${x0 + barW},${y1 + r} L${x0 + barW},${y1 + hgt} Z`;
                      return <path key={p.label} d={path} fill={p.color} style={{ transition: "d 400ms" }} />;
                    })}
                  </g>
                  {(i % labelEvery === 0 || data.length <= 12) && (
                    <text x={cx} y={height - 8} textAnchor="middle" fill={active === d.key ? "currentColor" : "var(--viz-text)"} fontSize={12} fontWeight={active === d.key ? 600 : 400} className={active === d.key ? "text-ink" : ""}>
                      {d.label}
                    </text>
                  )}
                  {data.length <= 12 && totals[i]! > 0 && (
                    <text x={cx} y={y(totals[i]!) - 7} textAnchor="middle" fontSize={12} className={`${intro ? "viz-fade " : ""}fill-ink-soft tabular-nums`}>
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
                    role={onSelect ? "button" : undefined}
                    className={onSelect ? "cursor-pointer outline-none" : "outline-none"}
                    aria-label={`${d.title ?? d.label}: ${fmtInt.format(totals[i]!)}`}
                    onClick={onSelect ? () => onSelect(data[i]!) : undefined}
                    onKeyDown={onSelect ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onSelect(data[i]!)) : undefined}
                    onPointerMove={() => {
                      setHover(d.key);
                      setTip({
                        x: Math.min(Math.max(cx, 80), width - 80),
                        y: y(totals[i]!),
                        content: (
                          <div>
                            <TipTitle>{d.title ?? d.label}</TipTitle>
                            {d.parts.length > 1 && <TipRow label="total" value={fmtInt.format(totals[i]!)} />}
                            {[...d.parts].reverse().map((p) => (
                              <TipRow key={p.label} color={p.color} label={p.label.toLowerCase()} value={fmtInt.format(p.value)} />
                            ))}
                            {d.extra?.map((e) => <TipRow key={e.label} label={e.label} value={e.value} />)}
                            {onSelect && selectHint && <TipHint>{selectHint}</TipHint>}
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
      {legend && series.length > 1 && (
        <div className="mt-4">
          <Legend items={series} hidden={hidden} onToggle={toggle} />
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
      <div className={`${thick ? "h-2" : "h-[5px]"} w-full overflow-hidden rounded-full bg-paper dark:bg-slate-800`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max} aria-label={label}>
        <div className="viz-grow-x h-full rounded-full transition-[width] duration-700" style={{ width: `${p * 100}%`, background: color }} />
      </div>
      {m !== null && <span className="viz-fade absolute -top-1.5 -bottom-1.5 w-0.5 -translate-x-1/2 rounded-full bg-ink" style={{ left: `${m * 100}%`, animationDelay: "500ms" }} title={markLabel} aria-hidden />}
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

export function DataTable<T>({
  rows,
  cols,
  initialSort,
  empty = "Sin datos.",
  maxRows = 12,
  onRowClick,
  rowHint,
  isActive,
}: {
  rows: T[];
  cols: Col<T>[];
  initialSort?: string;
  empty?: string;
  maxRows?: number;
  onRowClick?: (row: T) => void;
  rowHint?: string;
  isActive?: (row: T) => boolean;
}) {
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
    <div className="-mx-6 overflow-x-auto sm:-mx-8">
      <table className="w-full text-[14px]">
        <thead>
          <tr className="text-[12px] text-ink-faint">
            {cols.map((c) => (
              <th key={c.key} className={`px-6 pb-4 font-normal whitespace-nowrap sm:px-8 ${c.align === "right" ? "text-right" : "text-left"}`} aria-sort={sort?.key === c.key ? (sort.dir === -1 ? "descending" : "ascending") : undefined}>
                {c.sort ? (
                  <button
                    className={`inline-flex items-center gap-1 transition-colors hover:text-ink ${sort?.key === c.key ? "text-ink" : ""}`}
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
          {visible.map((r, i) => {
            const on = isActive?.(r);
            return (
              <tr
                key={i}
                onClick={onRowClick ? () => onRowClick(r) : undefined}
                onKeyDown={onRowClick ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onRowClick(r)) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                title={onRowClick ? rowHint : undefined}
                className={`group border-t border-hair transition-colors outline-none ${onRowClick ? "cursor-pointer hover:bg-paper/70 focus-visible:bg-paper dark:hover:bg-slate-800/40" : ""} ${on ? "bg-brand-50/60 dark:bg-brand-500/10" : ""}`}
              >
                {cols.map((c, j) => (
                  <td key={c.key} className={`px-6 py-4 whitespace-nowrap sm:px-8 ${c.align === "right" ? "text-right tabular-nums" : ""} ${j === 0 ? "text-ink" : "text-ink/80"}`}>
                    {j === 0 && onRowClick ? (
                      <span className="inline-flex items-center gap-1">
                        {c.render(r)}
                        <ChevronRight className="size-3.5 text-brand-600 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
                      </span>
                    ) : (
                      c.render(r)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {sorted.length > maxRows && (
        <div className="border-t border-hair px-6 pt-5 sm:px-8">
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
      <span className="hidden h-1 w-20 overflow-hidden rounded-full bg-paper sm:inline-block dark:bg-slate-800">
        <span className="viz-grow-x block h-full rounded-full bg-[var(--viz-1)]" style={{ width: `${Math.min((value / (max || 1)) * 100, 100)}%` }} />
      </span>
      <span className="w-14 tabular-nums">{fmtPct(value, digits)}</span>
    </span>
  );
}
