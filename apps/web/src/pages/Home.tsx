import { CAMPAIGNS } from "@crm/core";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { Badge, Card, PageHeader, StatusDot } from "../components/ui";
import { api } from "../lib/api";
import { monthLabel } from "../lib/xlsx";

export function Home() {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, retry: false });
  const h = health.data;
  const uploads = useQuery({ queryKey: ["uploads", "todas"], queryFn: () => api.uploads() });
  const fmt = new Intl.NumberFormat("es-SV");

  return (
    <>
      <PageHeader title="Panel Ejecutivo" subtitle="Las 6 campañas Davivienda en una sola vista." actions={<Badge tone="brand">Versión 2.0</Badge>} />

      <Card className="mb-6">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <p className="text-sm font-semibold">Estado del sistema</p>
          <StatusDot ok={h?.d1} label="Base de datos (D1)" />
          <StatusDot ok={h?.r2} label="Archivos (R2)" />
          {health.isError && <span className="text-sm text-red-600">No se pudo consultar el estado.</span>}
        </div>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {CAMPAIGNS.map((c) => {
          const current = (uploads.data ?? []).filter((u) => u.campaign === c.code && u.isCurrent);
          const lastMonth = current.map((u) => u.month).sort().at(-1);
          const inLast = current.filter((u) => u.month === lastMonth);
          const loaded = new Set(inLast.map((u) => u.dataset));
          const rows = inLast.reduce((n, u) => n + u.rowsValid, 0);
          return (
          <Link key={c.code} to={`/campanas/${c.code}`} className="group">
            <Card className="h-full transition-shadow group-hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">{c.shortName}</p>
                  <h2 className="mt-1 font-semibold">{c.name}</h2>
                </div>
                <ArrowRight className="size-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-500" aria-hidden />
              </div>
              {lastMonth ? (
                <>
                  <p className="mt-6 text-3xl font-semibold capitalize">{monthLabel(lastMonth)}</p>
                  <p className="mt-1 text-sm text-slate-500">Último mes cargado, {fmt.format(rows)} filas</p>
                </>
              ) : (
                <>
                  <p className="mt-6 text-3xl font-semibold text-slate-300 dark:text-slate-700">—</p>
                  <p className="mt-1 text-sm text-slate-500">Sin datos cargados todavía</p>
                </>
              )}
              <div className="mt-4 flex flex-wrap gap-1.5">
                {c.datasets.map((d) => (
                  <Badge key={d.id} tone={loaded.has(d.id) ? "brand" : "neutral"}>
                    {d.label}
                  </Badge>
                ))}
              </div>
            </Card>
          </Link>
          );
        })}
      </div>
    </>
  );
}
