/* Piezas visuales básicas: tinta azul marino, líneas finas, sin sombras. */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-ink">{title}</h1>
        {subtitle && <p className="mt-1.5 max-w-2xl text-[14px] text-ink-soft">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[20px] border border-hair bg-white p-5 dark:bg-slate-900 ${className}`}>{children}</div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-5 flex size-12 items-center justify-center rounded-full border border-hair text-ink-soft">
        <Icon className="size-5" strokeWidth={1.5} aria-hidden />
      </div>
      <h2 className="text-[16px] font-semibold text-ink">{title}</h2>
      {children && <div className="mt-2 max-w-md text-sm text-ink-soft">{children}</div>}
    </Card>
  );
}

export function StatusDot({ ok, label }: { ok: boolean | undefined; label: string }) {
  const color = ok === undefined ? "bg-slate-300" : ok ? "bg-emerald-500" : "bg-red-500";
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <span className={`size-2 rounded-full ${color}`} aria-hidden />
      {label}
      <span className="sr-only">{ok === undefined ? "verificando" : ok ? "funcionando" : "con problemas"}</span>
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "brand" | "accent" }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
    brand: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-100",
    accent: "bg-orange-50 text-accent-500 dark:bg-accent-500/15 dark:text-accent-400",
  };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
