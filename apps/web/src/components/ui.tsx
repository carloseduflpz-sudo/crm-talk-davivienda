/* Piezas visuales básicas. Se refinan en la Fase 3 (diseño). */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-brand-900 dark:text-white">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}>{children}</div>
  );
}

export function EmptyState({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-500/10">
        <Icon className="size-6" aria-hidden />
      </div>
      <h2 className="text-base font-semibold">{title}</h2>
      {children && <div className="mt-2 max-w-md text-sm text-slate-500 dark:text-slate-400">{children}</div>}
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
