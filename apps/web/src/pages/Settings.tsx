import { BookOpen, ChevronRight, ClipboardList, History, Target, Users as UsersIcon, type LucideIcon } from "lucide-react";
import { Link } from "react-router";
import { Badge, Card, PageHeader } from "../components/ui";

const SECTIONS: { to?: string; icon: LucideIcon; title: string; about: string; phase?: string }[] = [
  { to: "/configuracion/usuarios", icon: UsersIcon, title: "Usuarios", about: "Altas, contraseñas temporales, roles y desbloqueos." },
  { icon: Target, title: "Metas", about: "Meta de ventas y agentes por campaña y mes.", phase: "Fase 1" },
  { icon: ClipboardList, title: "Agentes y alias", about: "Cómo aparece cada agente en VICI, la sábana y el CRM.", phase: "Fase 1" },
  { icon: BookOpen, title: "Catálogos", about: "Estatus del banco y tipologías de VICI por campaña.", phase: "Fase 1" },
  { icon: History, title: "Bitácora y respaldos", about: "Quién cambió qué, y restauración de versiones.", phase: "Fase 1" },
];

export function Settings() {
  return (
    <>
      <PageHeader title="Configuración" subtitle="Usuarios, metas, catálogos, cierres, bitácora y respaldos." />
      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => {
          const inner = (
            <Card className={`flex h-full items-start gap-4 ${s.to ? "transition-shadow hover:shadow-md" : ""}`}>
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 dark:bg-brand-500/10">
                <s.icon className="size-5" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold">{s.title}</p>
                  {s.phase && <Badge>{s.phase}</Badge>}
                </div>
                <p className="mt-1 text-sm text-slate-500">{s.about}</p>
              </div>
              {s.to && <ChevronRight className="size-4 text-slate-400" aria-hidden />}
            </Card>
          );
          return s.to ? (
            <Link key={s.title} to={s.to}>
              {inner}
            </Link>
          ) : (
            <div key={s.title}>{inner}</div>
          );
        })}
      </div>
    </>
  );
}
