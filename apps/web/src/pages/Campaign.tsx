import { getCampaign, isCampaignCode } from "@crm/core";
import { BarChart3, Database, PhoneCall, Target, TrendingUp } from "lucide-react";
import { Link, NavLink, Navigate, useParams } from "react-router";
import { EmptyState, PageHeader } from "../components/ui";

export const CAMPAIGN_TABS = [
  { slug: "ventas", label: "Ventas", icon: TrendingUp, needs: "sabana", about: "Embudo por estatus del banco, rechazo por motivo y comparativo mensual." },
  { slug: "base", label: "Base", icon: Database, needs: "base", about: "Tamaño de la base por mes, cruce contra ventas y segmentos por perfil." },
  { slug: "efectividad", label: "Efectividad", icon: BarChart3, needs: "tipif", about: "Contactabilidad, penetración y registros, general y por agente." },
  { slug: "llamadas", label: "Llamadas", icon: PhoneCall, needs: "tipif", about: "Tipificaciones, intentos por cliente y estructura de contacto." },
  { slug: "cumplimiento", label: "Cumplimiento", icon: Target, needs: "sabana", about: "Meta, avance, faltante, ritmo necesario y gap por agente." },
] as const;

export function Campaign() {
  const { code = "", tab } = useParams();
  if (!isCampaignCode(code)) return <Navigate to="/" replace />;
  const current = CAMPAIGN_TABS.find((t) => t.slug === tab);
  if (!current) return <Navigate to={`/campanas/${code}/ventas`} replace />;

  const campaign = getCampaign(code);
  const needed = campaign.datasets.filter((d) => d.kind === current.needs).map((d) => d.label);

  return (
    <>
      <PageHeader title={campaign.name} subtitle={current.about} />
      <div role="tablist" aria-label="Secciones de la campaña" className="mb-6 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800">
        {CAMPAIGN_TABS.map((t) => (
          <NavLink
            key={t.slug}
            to={`/campanas/${code}/${t.slug}`}
            role="tab"
            aria-selected={t.slug === current.slug}
            className={({ isActive }) =>
              `-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm whitespace-nowrap transition-colors ${
                isActive ? "border-brand-500 font-medium text-brand-600 dark:text-white" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`
            }
          >
            <t.icon className="size-4" aria-hidden />
            {t.label}
          </NavLink>
        ))}
      </div>
      <EmptyState icon={current.icon} title={`${current.label}: los análisis llegan en la Fase 2`}>
        Se alimenta de: <strong className="font-medium text-slate-700 dark:text-slate-200">{needed.join(", ")}</strong>. Ya puedes cargar esos archivos en el{" "}
        <Link to={`/carga?campana=${code}`} className="font-medium text-brand-600 hover:underline">
          Centro de carga
        </Link>
        .
      </EmptyState>
    </>
  );
}
